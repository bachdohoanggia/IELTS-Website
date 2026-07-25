// dashboard.js

// Firebase SDK Imports
import { auth, db } from "./firebase.js";
import {
    signOut,
    onAuthStateChanged,
    updatePassword,
    EmailAuthProvider,
    reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    arrayUnion,
    query,
    collection,
    where,
    getDocs,
    deleteDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const USERS_COLLECTION = "users";
const CLASSES_COLLECTION = "classes"; // collection for classes
const INVITES_COLLECTION = "classInvites";

// --- Global variables for user and classes ---
let currentUser = null;
let userClasses = [];   

document.addEventListener('DOMContentLoaded', () => {
    const plusButton = document.getElementById('plusButton');
    const plusMenu = document.getElementById('plusMenu');
    const avatar = document.getElementById('avatar');
    const avatarMenu = document.getElementById('avatarMenu');
    const accountSettingsButton = document.getElementById('accountSettingsButton');
    const logoutButton = document.getElementById('logoutButton');
    const joinClassModal = document.getElementById('joinClassModal');
    const createClassModal = document.getElementById('createClassModal');
    const accountSettingsModal = document.getElementById('accountSettingsModal');
    const accountSettingsForm = document.getElementById('accountSettingsForm');
    const accountFirstnameInput = document.getElementById('accountFirstname');
    const accountCurrentPasswordInput = document.getElementById('accountCurrentPassword');
    const accountPasswordInput = document.getElementById('accountPassword');
    const accountConfirmPasswordInput = document.getElementById('accountConfirmPassword');
    const accountSettingsMessage = document.getElementById('accountSettingsMessage');
    const cancelAccountSettings = document.getElementById('cancelAccountSettings');
    const joinClassButton = plusMenu.querySelector('.dropdown-item:nth-child(1)');
    const createClassButton = plusMenu.querySelector('.dropdown-item:nth-child(2)');
    const cancelJoin = document.getElementById('cancelJoin');
    const cancelCreate = document.getElementById('cancelCreate');
    const classCodeInput = document.getElementById('classCode');
    const joinButton = document.getElementById('joinButton');
    const createButton = document.getElementById('createButton');
    const classFormTitle = document.getElementById('classFormTitle');
    const classNameInput = document.getElementById('className');
    const sectionInput = document.getElementById('section');
    const subjectInput = document.getElementById('subject');
    const roomInput = document.getElementById('room');
    const createClassForm = document.getElementById('createClassForm');
    const classContainer = document.getElementById('classContainer');
    const noClassMessage = document.getElementById('noClassMessage');
    const classOptions = document.getElementById('classOptions');
    const usernameDisplay = document.getElementById('usernameDisplay'); 
    const inviteBanner = document.getElementById('inviteBanner');
    const inviteMessage = document.getElementById('inviteMessage');
    const acceptInviteBtn = document.getElementById('acceptInviteBtn');
    const declineInviteBtn = document.getElementById('declineInviteBtn');
    let selectedClassIndex = null;
    let isClassOptionsVisible = false;
    let classFormMode = 'create';
    let editingClassIndex = null;
    let pendingInvites = [];
    let activeInvite = null;

    // --- Authentication State Listener ---
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            console.log("User logged in:", user.uid);
            const userDocRef = doc(db, USERS_COLLECTION, user.uid);
            const userDocSnap = await getDoc(userDocRef);

            if (userDocSnap.exists()) {
                currentUser = { uid: user.uid, ...userDocSnap.data() };
                console.log("Current user profile loaded:", currentUser);

                if (usernameDisplay) {
                    usernameDisplay.textContent = currentUser.firstname || currentUser.email || 'Guest';
                }

                await loadUserClasses();
                await loadPendingInvites();
            } else {
                console.warn("User profile not found in Firestore for UID:", user.uid);
                // Redirect to signup or create a basic profile if needed
                window.location.href = 'index.html'; // Or handle error/redirect
            }
        } else {
            // User is signed out
            console.log("User not logged in, redirecting to index.html");
            window.location.href = 'index.html';
        }
    });

    async function loadUserClasses() {
        if (!currentUser || !currentUser.uid) {
            console.warn("Cannot load classes: currentUser is not set.");
            return;
        }

        try {
            const q = query(collection(db, CLASSES_COLLECTION), 
                            where("members", "array-contains", {
                                id: currentUser.uid,
                                name: currentUser.firstname + (currentUser.lastname ? ' ' + currentUser.lastname : ''),
                                role: currentUser.role,
                                avatar: currentUser.avatar || 'account.png'
                            }));

            const querySnapshot = await getDocs(q);
            userClasses = []; // Reset userClasses
            querySnapshot.forEach((doc) => {
                userClasses.push({ id: doc.id, ...doc.data() });
            });
            console.log("User classes loaded:", userClasses);
            renderClasses();
        } catch (error) {
            console.error("Error loading user classes:", error);
            // Optionally display an error message to the user
        }
    }

    function buildCurrentUserMember(role = 'student') {
        return {
            id: currentUser.uid,
            name: currentUser.firstname + (currentUser.lastname ? ' ' + currentUser.lastname : ''),
            role,
            avatar: currentUser.avatar || 'account.png'
        };
    }

    function openAccountSettingsModal() {
        if (!currentUser) return;
        accountFirstnameInput.value = currentUser.firstname || '';
        accountCurrentPasswordInput.value = '';
        accountPasswordInput.value = '';
        accountConfirmPasswordInput.value = '';
        accountSettingsMessage.textContent = '';
        accountSettingsMessage.className = 'settings-message';
        accountSettingsModal.classList.remove('hidden');
        avatarMenu.classList.add('hidden');
    }

    function closeAccountSettingsModal() {
        accountSettingsModal.classList.add('hidden');
        accountSettingsForm.reset();
        accountSettingsMessage.textContent = '';
        accountSettingsMessage.className = 'settings-message';
    }

    async function syncCurrentUserNameInLoadedClasses(firstname) {
        const newName = firstname;
        await Promise.all(userClasses.map(async (classData, index) => {
            const members = Array.isArray(classData.members) ? classData.members : [];
            const nextMembers = members.map(member => (
                member.id === currentUser.uid
                    ? { ...member, name: newName, avatar: currentUser.avatar || member.avatar || 'account.png' }
                    : member
            ));
            const changed = JSON.stringify(members) !== JSON.stringify(nextMembers);
            if (!changed) return;
            await updateDoc(doc(db, CLASSES_COLLECTION, classData.classCode), {
                members: nextMembers,
                updatedAt: new Date()
            });
            userClasses[index] = { ...classData, members: nextMembers };
        }));
    }

    async function loadPendingInvites() {
        if (!currentUser || !inviteBanner) return;

        try {
            const invitesQuery = query(
                collection(db, INVITES_COLLECTION),
                where("recipientUid", "==", currentUser.uid),
                where("status", "==", "pending")
            );
            const snapshot = await getDocs(invitesQuery);
            pendingInvites = [];
            snapshot.forEach((inviteDoc) => {
                pendingInvites.push({ id: inviteDoc.id, ...inviteDoc.data() });
            });
            pendingInvites.sort((a, b) => {
                const aTime = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
                const bTime = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
                return bTime - aTime;
            });
            renderInviteBanner();
        } catch (error) {
            console.error("Error loading pending invites:", error);
        }
    }

    function renderInviteBanner() {
        activeInvite = pendingInvites[0] || null;
        if (!activeInvite) {
            inviteBanner.classList.add('hidden');
            return;
        }

        inviteMessage.textContent = `${activeInvite.teacherName || 'A teacher'} invited you to join ${activeInvite.className || activeInvite.classCode}.`;
        inviteBanner.classList.remove('hidden');
    }

    async function acceptActiveInvite() {
        return window.withButtonLock(null, async () => {
        if (!activeInvite || !currentUser) return;

        try {
            const classRef = doc(db, CLASSES_COLLECTION, activeInvite.classCode);
            const classSnap = await getDoc(classRef);
            if (!classSnap.exists()) {
                await updateDoc(doc(db, INVITES_COLLECTION, activeInvite.id), {
                    status: "cancelled",
                    updatedAt: new Date()
                });
                alert("This class no longer exists.");
                await loadPendingInvites();
                return;
            }

            const classData = classSnap.data();
            const isAlreadyMember = Array.isArray(classData.members) && classData.members.some(member => member.id === currentUser.uid);
            if (!isAlreadyMember) {
                await updateDoc(classRef, {
                    members: arrayUnion(buildCurrentUserMember('student'))
                });
            }
            await updateDoc(doc(db, INVITES_COLLECTION, activeInvite.id), {
                status: "accepted",
                updatedAt: new Date()
            });
            await loadUserClasses();
            await loadPendingInvites();
        } catch (error) {
            console.error("Error accepting invite:", error);
            alert("Failed to accept invite: " + error.message);
        }
        });
    }

    async function declineActiveInvite() {
        return window.withButtonLock(null, async () => {
        if (!activeInvite) return;

        try {
            await updateDoc(doc(db, INVITES_COLLECTION, activeInvite.id), {
                status: "declined",
                updatedAt: new Date()
            });
            await loadPendingInvites();
        } catch (error) {
            console.error("Error declining invite:", error);
            alert("Failed to decline invite: " + error.message);
        }
        });
    }

    const toggleMenu = (menu) => {
        menu.classList.toggle('hidden');
    };

    // --- Event Listeners ---
    plusButton.addEventListener('click', (e) => {
        toggleMenu(plusMenu);
        avatarMenu.classList.add('hidden');
        e.stopPropagation();
    });

    avatar.addEventListener('click', (e) => {
        toggleMenu(avatarMenu);
        plusMenu.classList.add('hidden');
        e.stopPropagation();
    });

    document.addEventListener('click', () => {
        plusMenu.classList.add('hidden');
        avatarMenu.classList.add('hidden');
        classOptions.classList.add('hidden');
        isClassOptionsVisible = false;
    });

    plusMenu.addEventListener('click', (e) => e.stopPropagation());
    avatarMenu.addEventListener('click', (e) => e.stopPropagation());
    classOptions.addEventListener('click', (e) => e.stopPropagation());

    accountSettingsButton.addEventListener('click', (e) => {
        e.stopPropagation();
        openAccountSettingsModal();
    });

    cancelAccountSettings.addEventListener('click', closeAccountSettingsModal);

    accountSettingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        return window.withButtonLock(e.submitter || saveAccountSettingsButton, async () => {
        if (!currentUser || !auth.currentUser) return;

        const firstname = accountFirstnameInput.value.trim();
        const currentPassword = accountCurrentPasswordInput.value;
        const newPassword = accountPasswordInput.value;
        const confirmPassword = accountConfirmPasswordInput.value;
        const wantsPasswordChange = Boolean(currentPassword || newPassword || confirmPassword);

        accountSettingsMessage.className = 'settings-message error';
        if (!firstname) {
            accountSettingsMessage.textContent = 'Username is required.';
            return;
        }
        if (wantsPasswordChange) {
            if (!currentPassword) {
                accountSettingsMessage.textContent = 'Current password is required.';
                return;
            }
            if (!newPassword) {
                accountSettingsMessage.textContent = 'New password is required.';
                return;
            }
            if (newPassword === currentPassword) {
                accountSettingsMessage.textContent = 'New password must be different from your current password.';
                return;
            }
            if (!confirmPassword) {
                accountSettingsMessage.textContent = 'Confirm new password is required.';
                return;
            }
            if (newPassword !== confirmPassword) {
                accountSettingsMessage.textContent = 'Passwords do not match.';
                return;
            }
            if (newPassword.length < 6) {
                accountSettingsMessage.textContent = 'Password must be at least 6 characters.';
                return;
            }
        }

        try {
            if (wantsPasswordChange) {
                const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
                await reauthenticateWithCredential(auth.currentUser, credential);
            }

            await updateDoc(doc(db, USERS_COLLECTION, currentUser.uid), {
                firstname,
                lastname: '',
                updatedAt: new Date()
            });

            currentUser = { ...currentUser, firstname, lastname: '' };
            if (usernameDisplay) {
                usernameDisplay.textContent = currentUser.firstname || currentUser.email || 'Guest';
            }

            await syncCurrentUserNameInLoadedClasses(firstname);
            renderClasses();

            if (wantsPasswordChange) {
                await updatePassword(auth.currentUser, newPassword);
            }

            accountSettingsMessage.className = 'settings-message success';
            accountSettingsMessage.textContent = 'Account updated.';
            accountCurrentPasswordInput.value = '';
            accountPasswordInput.value = '';
            accountConfirmPasswordInput.value = '';
            closeAccountSettingsModal();
        } catch (error) {
            console.error("Error updating account settings:", error);
            accountSettingsMessage.className = 'settings-message error';
            if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                accountSettingsMessage.textContent = 'Current password is incorrect.';
            } else if (error.code === 'auth/requires-recent-login') {
                accountSettingsMessage.textContent = 'Please log out and log in again before changing your password.';
            } else {
                accountSettingsMessage.textContent = 'Failed to update account: ' + error.message;
            }
        }
        });
    });

    // --- Logout Functionality ---
    logoutButton.addEventListener('click', async (event) => {
        return window.withButtonLock(event, async () => {
        try {
            await signOut(auth);
            console.log("User signed out successfully.");
            window.location.href = 'index.html'; // Redirect to login page
        } catch (error) {
            console.error("Error signing out:", error);
            // Optionally display an error message
            alert("Error signing out: " + error.message);
        }
        });
    });

    if (acceptInviteBtn) {
        acceptInviteBtn.addEventListener('click', acceptActiveInvite);
    }

    if (declineInviteBtn) {
        declineInviteBtn.addEventListener('click', declineActiveInvite);
    }

    // --- Modal Control ---
    joinClassButton.addEventListener('click', (e) => {
        joinClassModal.classList.remove('hidden');
        plusMenu.classList.add('hidden');
        e.stopPropagation();
    });

    function openCreateClassModal() {
        classFormMode = 'create';
        editingClassIndex = null;
        createClassForm.reset();
        if (classFormTitle) classFormTitle.textContent = 'Create class';
        createButton.textContent = 'Create';
        createButton.disabled = true;
        createClassModal.classList.remove('hidden');
    }

    function openEditClassModal(index) {
        const classData = userClasses[index];
        if (!classData) return;
        if (currentUser.uid !== classData.createdBy) {
            alert("Only the class creator can edit this class.");
            return;
        }

        classFormMode = 'edit';
        editingClassIndex = index;
        classNameInput.value = classData.className || '';
        sectionInput.value = classData.section || '';
        subjectInput.value = classData.subject || '';
        roomInput.value = classData.room || '';
        if (classFormTitle) classFormTitle.textContent = 'Edit class';
        createButton.textContent = 'Update';
        createButton.disabled = classNameInput.value.trim() === '';
        createClassModal.classList.remove('hidden');
    }

    function closeCreateClassModal() {
        createClassModal.classList.add('hidden');
        createClassForm.reset();
        classFormMode = 'create';
        editingClassIndex = null;
        if (classFormTitle) classFormTitle.textContent = 'Create class';
        createButton.textContent = 'Create';
        createButton.disabled = true;
    }

    function canManageClass(classData) {
        return Boolean(
            currentUser
            && currentUser.role === 'teacher'
            && classData
            && currentUser.uid === classData.createdBy
        );
    }

    createClassButton.addEventListener('click', (e) => {
        if (!currentUser || currentUser.role !== 'teacher') {
            alert("Only teachers can create classes.");
            plusMenu.classList.add('hidden');
            return;
        }
        openCreateClassModal();
        plusMenu.classList.add('hidden');
        e.stopPropagation();
    });

    cancelJoin.addEventListener('click', () => {
        joinClassModal.classList.add('hidden');
        classCodeInput.value = '';
        const errorMessage = document.getElementById('classCodeError');
        if (errorMessage) {
            errorMessage.remove();
        }
    });

    cancelCreate.addEventListener('click', () => {
        closeCreateClassModal();
    });

    classCodeInput.addEventListener('input', () => {
        joinButton.disabled = !/^[a-zA-Z0-9]{5,8}$/.test(classCodeInput.value.trim());
        const errorMessage = document.getElementById('classCodeError');
        if (errorMessage) {
            errorMessage.remove();
        }
    });

    classNameInput.addEventListener('input', () => {
        createButton.disabled = classNameInput.value.trim() === '';
    });

    // --- Create Class (Firebase) ---
    createClassForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        return window.withButtonLock(e.submitter || createButton, async () => {
        if (!currentUser || currentUser.role !== 'teacher') {
            alert("You must be a teacher to create a class.");
            return;
        }

        const className = classNameInput.value.trim();
        const section = sectionInput.value.trim();
        const subject = subjectInput.value.trim();
        const room = roomInput.value.trim();
        const classCode = Math.random().toString(36).substring(2, 7).toUpperCase(); // Generate code

        if (className) {
            if (classFormMode === 'edit') {
                const classToEdit = userClasses[editingClassIndex];
                if (!classToEdit) {
                    alert("No class selected to edit.");
                    return;
                }
                if (currentUser.uid !== classToEdit.createdBy) {
                    alert("Only the class creator can edit this class.");
                    return;
                }

                try {
                    const updates = {
                        className,
                        section,
                        subject,
                        room,
                        updatedAt: new Date()
                    };
                    await updateDoc(doc(db, CLASSES_COLLECTION, classToEdit.classCode), updates);
                    userClasses[editingClassIndex] = {
                        ...classToEdit,
                        ...updates
                    };
                    renderClasses();
                    closeCreateClassModal();
                } catch (error) {
                    console.error("Error updating class:", error);
                    alert("Failed to update class: " + error.message);
                }
                return;
            }

            const teacherMember = {
                id: currentUser.uid,
                name: currentUser.firstname + (currentUser.lastname ? ' ' + currentUser.lastname : ''),
                role: 'teacher',
                avatar: currentUser.avatar || 'account.png'
            };

            const newClassData = {
                className,
                section,
                subject,
                room,
                classCode,
                createdBy: currentUser.uid, // Lưu UID của người tạo lớp
                members: [teacherMember] // Khởi tạo với giáo viên tạo lớp là thành viên đầu tiên
            };

            try {
                await setDoc(doc(db, CLASSES_COLLECTION, classCode), newClassData); // Dùng classCode làm ID
                console.log("Class created with ID:", classCode);

                // Cập nhật danh sách lớp học cục bộ
                userClasses.push({ id: classCode, ...newClassData }); 

                renderClasses();
                createClassModal.classList.add('hidden');
                
                window.location.href = `class.html?classCode=${classCode}`; // Redirect to class page
            } catch (error) {
                console.error("Error creating class:", error);
                alert("Failed to create class: " + error.message);
            }
        }
        });
    });

    // --- Join Class (Firebase) ---
    joinButton.addEventListener('click', async (event) => {
        return window.withButtonLock(event, async () => {
        const classCode = classCodeInput.value.trim();
        const classCodeError = document.getElementById('classCodeError') || document.createElement('p');
        classCodeError.id = 'classCodeError';
        classCodeError.style.color = 'red';
        classCodeError.style.fontSize = '1em';
        classCodeError.style.marginTop = '3px';
        if (!classCodeInput.parentNode.contains(classCodeError)) {
            classCodeInput.parentNode.appendChild(classCodeError);
        }
        classCodeError.textContent = '';

        if (!currentUser || !currentUser.uid) {
            classCodeError.textContent = 'Please log in to join a class.';
            return;
        }

        try {
            // Tìm lớp học trong collection 'classes' bằng classCode
            const classDocRef = doc(db, CLASSES_COLLECTION, classCode);
            const classDocSnap = await getDoc(classDocRef);

            if (classDocSnap.exists()) {
                const joinedClassData = { id: classDocSnap.id, ...classDocSnap.data() };
                
                // Kiểm tra xem người dùng đã tham gia lớp này chưa
                const isAlreadyJoined = joinedClassData.members.some(member => member.id === currentUser.uid);

                if (!isAlreadyJoined) {
                    const studentMember = buildCurrentUserMember('student');

                    // Thêm học sinh vào mảng 'members' của lớp học trong Firestore
                    await updateDoc(classDocRef, {
                        members: arrayUnion(studentMember)
                    });
                    console.log("Student added to class members in Firestore:", studentMember);

                    // Cập nhật danh sách lớp học cục bộ và hiển thị lại
                    userClasses.push(joinedClassData);
                    renderClasses();
                    joinClassModal.classList.add('hidden');
                    classCodeInput.value = '';
                    
                    // Chuyển hướng đến trang lớp học sau khi tham gia thành công
                    window.location.href = `class.html?classCode=${classCode}`; 

                } else {
                    classCodeError.textContent = 'You have already joined this class.';
                }
            } else {
                classCodeError.textContent = 'Invalid class code. Class not found.';
            }
        } catch (error) {
            console.error("Error joining class:", error);
            classCodeError.textContent = 'Failed to join class: ' + error.message;
        }
        });
    });
    
    // --- Render Classes ---
    function renderClasses() {
        classContainer.innerHTML = '';
        if (userClasses.length === 0) {
            noClassMessage.classList.remove('hidden');
        } else {
            noClassMessage.classList.add('hidden');
            userClasses.forEach((classData, index) => {
                const classCard = document.createElement('div');
                classCard.className = 'class-card';
                classCard.dataset.index = index;
                const memberCount = Array.isArray(classData.members) ? classData.members.length : 0;
                const classMeta = classData.subject || 'IELTS classroom';
                const showClassMenu = canManageClass(classData);

                classCard.innerHTML = `
                    <div class="class-info">
                        <div>
                            <span class="class-title">${classData.className}</span>
                            <p class="class-subtitle">${classMeta || 'IELTS classroom'}</p>
                        </div>
                        <div class="class-card-footer">
                            <div class="class-code-block">
                                <span class="class-label">Class code</span>
                                <strong>${classData.classCode}</strong>
                            </div>
                            <div class="class-stat">
                                <span>${memberCount}</span>
                                <small>${memberCount === 1 ? 'member' : 'members'}</small>
                            </div>
                        </div>
                    </div>
                    ${showClassMenu ? `<img src="PNG/Option.png" alt="Menu" class="menu-icon" data-index="${index}">` : ''}
                `;

                classCard.addEventListener('click', (e) => {
                    if (!e.target.classList.contains('menu-icon')) {
                        window.location.href = `class.html?classCode=${classData.classCode}`;
                    }
                });

                const menuIcon = classCard.querySelector('.menu-icon');
                if (menuIcon) {
                    menuIcon.addEventListener('click', (e) => {
                        e.stopPropagation(); 
                        showClassOptions(index, e.target);
                    });
                }

                classContainer.appendChild(classCard);
            });
        }
    }

    // --- Show Class Options ---
    function showClassOptions(index, icon) {
        if (!canManageClass(userClasses[index])) {
            classOptions.classList.add('hidden');
            isClassOptionsVisible = false;
            selectedClassIndex = null;
            return;
        }

        if (selectedClassIndex === index && isClassOptionsVisible) {
            classOptions.classList.add('hidden');
            isClassOptionsVisible = false;
            return;
        }
    
        selectedClassIndex = index;
        classOptions.classList.remove('hidden');
        isClassOptionsVisible = true;
    
        const rect = icon.getBoundingClientRect();
        classOptions.style.top = `${rect.top + window.scrollY + 30}px`;
        const menuWidth = classOptions.offsetWidth || 172;
        const left = Math.min(rect.right + window.scrollX - menuWidth, window.innerWidth - menuWidth - 16);
        classOptions.style.left = `${Math.max(16, left)}px`;
    }

    // Ensure document click handler hides classOptions
    document.addEventListener('click', () => {
        classOptions.classList.add('hidden');
        isClassOptionsVisible = false;
    });

    // --- Delete Class (Firebase) ---
    const editClassBtn = document.getElementById('editClassBtn');
    const deleteClassBtn = document.getElementById('deleteClassBtn');

    editClassBtn.addEventListener('click', () => {
        if (selectedClassIndex === null || !userClasses[selectedClassIndex]) {
            console.warn("No class selected to edit.");
            return;
        }
        if (!canManageClass(userClasses[selectedClassIndex])) {
            classOptions.classList.add('hidden');
            isClassOptionsVisible = false;
            alert("Only the class teacher can edit this class.");
            return;
        }
        classOptions.classList.add('hidden');
        isClassOptionsVisible = false;
        openEditClassModal(selectedClassIndex);
    });

    deleteClassBtn.addEventListener('click', async (event) => {
        return window.withButtonLock(event, async () => {
        if (selectedClassIndex === null || !userClasses[selectedClassIndex] || !currentUser || !currentUser.uid) {
            console.warn("No class selected or user not logged in.");
            return;
        }

        const classToDelete = userClasses[selectedClassIndex];
        if (!canManageClass(classToDelete)) {
            classOptions.classList.add('hidden');
            isClassOptionsVisible = false;
            alert("Only the class teacher can delete this class.");
            return;
        }

        const classCodeToDelete = classToDelete.classCode;
        const classDocRef = doc(db, CLASSES_COLLECTION, classCodeToDelete);
        const confirmMessage = `Do you want to delete "${classToDelete.className}"? This class cannot be restored after deletion.`;

        if (!await window.appConfirm(confirmMessage, { title: 'Delete class' })) {
            classOptions.classList.add('hidden');
            isClassOptionsVisible = false;
            return;
        }

        try {
            await deleteDoc(classDocRef);
            console.log("Class document deleted from Firestore:", classCodeToDelete);

            userClasses.splice(selectedClassIndex, 1);
            renderClasses();
            classOptions.classList.add('hidden');
            isClassOptionsVisible = false;

        } catch (error) {
            console.error("Error deleting/leaving class:", error);
            alert("Failed to remove class: " + error.message);
        }
        });
    });

    
});
