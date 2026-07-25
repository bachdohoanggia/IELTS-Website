// class.js

import { auth, db } from "./firebase.js";
import {
    onAuthStateChanged,
    signOut,
    updatePassword,
    EmailAuthProvider,
    reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
    doc,
    getDoc,
    addDoc,
    updateDoc,
    query,
    collection,
    where,
    getDocs,
    deleteDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";


let currentUser = null;     
let currentClassData = null;


const USERS_COLLECTION = "users";
const CLASSES_COLLECTION = "classes";
const TESTS_SUBCOLLECTION = "tests";
const TEST_FOLDERS_SUBCOLLECTION = "testFolders";
const INVITES_COLLECTION = "classInvites";
const STREAM_POSTS_SUBCOLLECTION = "streamPosts";
const STREAM_COMMENTS_SUBCOLLECTION = "comments";

const UNFILED_FOLDER_ID = "__unfiled__";

let currentClassFolders = [];
let currentClassTests = [];
let classworkSearchTerm = "";
let peopleSearchTerm = "";
let collapseClassworkAfterNextRender = false;
let preserveClassworkOpenStateAfterNextRender = false;
let openClassworkFolderIds = new Set();
let streamPostsCache = [];

function getFolderKey(folderId) {
    return folderId || UNFILED_FOLDER_ID;
}

function getTestCreatedTime(test) {
    if (test.createdAt?.toDate) return test.createdAt.toDate().getTime();
    const time = new Date(test.createdAt || 0).getTime();
    return Number.isNaN(time) ? 0 : time;
}

function sortTestsForFolder(tests) {
    return [...tests].sort((a, b) => {
        const aHasOrder = typeof a.order === 'number';
        const bHasOrder = typeof b.order === 'number';
        if (!aHasOrder && !bHasOrder) return getTestCreatedTime(b) - getTestCreatedTime(a);
        if (!aHasOrder) return -1;
        if (!bHasOrder) return 1;
        return a.order - b.order;
    });
}

function getTestsForFolder(folderId) {
    const key = getFolderKey(folderId);
    return sortTestsForFolder(currentClassTests.filter(test => getFolderKey(test.folderId) === key));
}

function captureOpenClassworkFolders() {
    openClassworkFolderIds = new Set(
        [...document.querySelectorAll('.test-folder-section')]
            .filter(section => !section.querySelector('.test-folder-body')?.classList.contains('hidden'))
            .map(section => section.dataset.folderId)
    );
}

function getClassworkOpenStateKey(classCode) {
    return `classworkOpenFolders:${classCode}`;
}

function saveOpenClassworkFoldersForReturn(classCode) {
    captureOpenClassworkFolders();
    sessionStorage.setItem(getClassworkOpenStateKey(classCode), JSON.stringify([...openClassworkFolderIds]));
}

function restoreOpenClassworkFoldersForReturn(classCode) {
    const saved = sessionStorage.getItem(getClassworkOpenStateKey(classCode));
    if (!saved) return;

    try {
        const folderIds = JSON.parse(saved);
        openClassworkFolderIds = new Set(Array.isArray(folderIds) ? folderIds : []);
        preserveClassworkOpenStateAfterNextRender = true;
    } catch (error) {
        console.warn("Could not restore classwork folder state:", error);
    } finally {
        sessionStorage.removeItem(getClassworkOpenStateKey(classCode));
    }
}

function normalizeAvatarPath(src) {
    if (!src) return 'PNG/user.png';
    if (/^(https?:|data:|\/)/.test(src)) return src;
    return src.startsWith('PNG/') ? src : `PNG/${src}`;
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getInitials(name = '') {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatStreamDate(value) {
    const date = value?.toDate ? value.toDate() : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function getCurrentMemberProfile() {
    const members = Array.isArray(currentClassData?.members) ? currentClassData.members : [];
    const member = members.find(item => item.id === currentUser?.uid) || {};
    return {
        name: member.name || getMemberName(currentUser) || currentUser?.email || 'User',
        avatar: member.avatar || currentUser?.avatar || 'account.png',
        role: member.role || currentUser?.role || 'student'
    };
}

function getMemberName(userData) {
    return userData.firstname + (userData.lastname ? ' ' + userData.lastname : '');
}

function getCurrentUserRole() {
    const members = Array.isArray(currentClassData?.members) ? currentClassData.members : [];
    return members.find(member => member.id === currentUser?.uid)?.role || 'student';
}

function isCurrentUserTeacher() {
    return getCurrentUserRole() === 'teacher';
}

function isTestVisibleToCurrentUser(test) {
    if (isCurrentUserTeacher()) return true;
    if (!test || test.assignedTo !== 'selected') return true;
    const assignedStudentIds = Array.isArray(test.assignedStudentIds) ? test.assignedStudentIds : [];
    return assignedStudentIds.includes(currentUser?.uid);
}

function getClassCodeFromUrl() {
    return new URLSearchParams(window.location.search).get('classCode');
}

function showClassLoader(message = 'Loading class...') {
    const loader = document.getElementById('classLoader');
    if (!loader) return;
    const text = loader.querySelector('p');
    if (text) text.textContent = message;
    loader.classList.remove('hidden');
}

function hideClassLoader() {
    const loader = document.getElementById('classLoader');
    if (loader) {
        loader.classList.add('hidden');
    }
}

async function displayClassMembers() {
    const teachersList = document.getElementById('teachersList');
    const studentsList = document.getElementById('studentsList');

    if (!teachersList || !studentsList) {
        console.error("One or more required elements for 'people' page (teachersList, studentsList) not found in class.html. Please check your HTML structure.");
        return;
    }

    teachersList.innerHTML = '';
    studentsList.innerHTML = '';

    if (!currentUser) {
        console.error("No loggedInUser found. Cannot display class members.");
        window.location.href = 'index.html';
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const classCode = urlParams.get('classCode');

    if (!currentClassData || currentClassData.classCode !== classCode) {
        console.warn("Class data not found for the current classCode:", classCode, ". Or data is outdated.");
       
        await loadClassData(classCode);
        if (!currentClassData || currentClassData.classCode !== classCode) {
            alert('Class not found or you do not have access.');
            window.location.href = 'dashboard.html';
            return;
        }
    }
    
    const classMembers = Array.isArray(currentClassData.members) ? currentClassData.members : [];

    if (classMembers.length === 0) {
        console.warn("Current class has no members or 'members' array is empty.", currentClassData);
        teachersList.innerHTML = `
            <div class="no-content-message">
                <img src="PNG/student_icon.png" alt="No Teachers" class="student_icon">
                <p class="message">No teachers have joined this class yet.</p>
            </div>
        `;
        studentsList.innerHTML = `
            <div class="no-content-message">
                <img src="PNG/student_icon.png" alt="No Students" class="student_icon">
                <p class="message">Add students to this class.</p>
            </div>
        `;
        return;
    }

    const matchesPeopleSearch = (member) => {
        if (!peopleSearchTerm) return true;
        return `${member.name || ''} ${member.email || ''}`.toLowerCase().includes(peopleSearchTerm);
    };
    const teachers = classMembers.filter(member => member.role === 'teacher' && matchesPeopleSearch(member));
    const students = classMembers.filter(member => member.role === 'student' && matchesPeopleSearch(member));

    if (teachers.length > 0) {
        teachers.forEach(teacher => {
            const memberDiv = document.createElement('div');
            memberDiv.classList.add('class-member');

            const avatarImg = document.createElement('div');
            avatarImg.textContent = getInitials(teacher.name);
            avatarImg.setAttribute('aria-label', `${teacher.name} avatar`);
            avatarImg.classList.add('member-avatar');

            const memberName = document.createElement('span');
            memberName.textContent = teacher.name;
            memberName.classList.add('member-name');
            
            memberDiv.appendChild(avatarImg);
            memberDiv.appendChild(memberName);
            teachersList.appendChild(memberDiv);
        });
    } else {
        teachersList.innerHTML = `
            <div class="no-content-message">
                <img src="PNG/student_icon.png" alt="No Teachers" class="student_icon">
                <p class="message">${peopleSearchTerm ? 'No teachers match your search.' : 'It looks like there are no teachers assigned yet. You might want to add one!'}</p>
            </div>
        `;
    }

    if (students.length > 0) {
        students.forEach(student => {
            const memberDiv = document.createElement('div');
            memberDiv.classList.add('class-member');

            const avatarImg = document.createElement('div');
            avatarImg.textContent = getInitials(student.name);
            avatarImg.setAttribute('aria-label', `${student.name} avatar`);
            avatarImg.classList.add('member-avatar');

            const memberName = document.createElement('span');
            memberName.textContent = student.name;
            memberName.classList.add('member-name');

            memberDiv.appendChild(avatarImg);
            memberDiv.appendChild(memberName);
            if (isCurrentUserTeacher()) {
                const kickButton = document.createElement('button');
                kickButton.type = 'button';
                kickButton.className = 'member-action danger-small';
                kickButton.textContent = 'Kick';
                kickButton.addEventListener('click', () => kickStudent(student));
                memberDiv.appendChild(kickButton);
            }
            studentsList.appendChild(memberDiv);
        });
    } else {
        studentsList.innerHTML = `
            <div class="no-content-message">
                <img src="PNG/student_icon.png" alt="No Students" class="student_icon">
                <p class="message">${peopleSearchTerm ? 'No students match your search.' : 'Add students to this class.'}</p>
            </div>
        `;
    }

    if (isCurrentUserTeacher()) {
        await renderPendingInvites();
    }
}

async function sendStudentInvite() {
    return window.withButtonLock(null, async () => {
    if (!isCurrentUserTeacher()) return;

    const emailInput = document.getElementById('studentInviteEmail');
    const messageEl = document.getElementById('inviteStudentMessage');
    const email = emailInput?.value.trim().toLowerCase();
    const classCode = getClassCodeFromUrl();

    if (!email) {
        if (messageEl) messageEl.textContent = 'Please enter a student email.';
        return;
    }

    try {
        if (messageEl) messageEl.textContent = '';
        const userQuery = query(collection(db, USERS_COLLECTION), where("email", "==", email));
        const userSnapshot = await getDocs(userQuery);

        if (userSnapshot.empty) {
            if (messageEl) messageEl.textContent = 'This email has not registered yet';
            return;
        }

        let invitedUser = null;
        userSnapshot.forEach((userDoc) => {
            if (!invitedUser) {
                invitedUser = { uid: userDoc.id, ...userDoc.data() };
            }
        });

        const currentUserEmail = (currentUser.email || auth.currentUser?.email || '').toLowerCase();
        const invitedUserEmail = (invitedUser.email || email).toLowerCase();
        if (invitedUser.uid === currentUser.uid || invitedUserEmail === currentUserEmail) {
            if (messageEl) messageEl.textContent = 'You cannot invite yourself.';
            return;
        }

        const classSnap = await getDoc(doc(db, CLASSES_COLLECTION, classCode));
        if (classSnap.exists()) {
            currentClassData = { id: classSnap.id, ...classSnap.data() };
        }

        const members = Array.isArray(currentClassData.members) ? currentClassData.members : [];
        const isAlreadyMember = members.some(member => {
            const memberEmail = (member.email || '').toLowerCase();
            return member.id === invitedUser.uid || memberEmail === invitedUserEmail;
        });
        if (isAlreadyMember) {
            if (messageEl) messageEl.textContent = 'This user is already in the class.';
            return;
        }

        const existingInviteQuery = query(
            collection(db, INVITES_COLLECTION),
            where("classCode", "==", classCode),
            where("recipientUid", "==", invitedUser.uid),
            where("status", "==", "pending")
        );
        const existingInviteSnapshot = await getDocs(existingInviteQuery);
        if (!existingInviteSnapshot.empty) {
            if (messageEl) messageEl.textContent = 'This student already has a pending invite.';
            return;
        }

        await addDoc(collection(db, INVITES_COLLECTION), {
            classCode,
            className: currentClassData.className || classCode,
            teacherId: currentUser.uid,
            teacherName: getMemberName(currentUser),
            recipientEmail: email,
            recipientUid: invitedUser.uid,
            status: "pending",
            createdAt: new Date(),
            updatedAt: new Date()
        });

        if (emailInput) emailInput.value = '';
        if (messageEl) messageEl.textContent = 'Invite sent.';
        await renderPendingInvites();
    } catch (error) {
        console.error("Error sending invite:", error);
        if (messageEl) messageEl.textContent = 'Failed to send invite: ' + error.message;
    }
    });
}

async function renderPendingInvites() {
    const pendingInvitesList = document.getElementById('pendingInvitesList');
    if (!pendingInvitesList || !isCurrentUserTeacher()) return;

    const classCode = getClassCodeFromUrl();
    pendingInvitesList.innerHTML = '';
    try {
        const invitesQuery = query(
            collection(db, INVITES_COLLECTION),
            where("classCode", "==", classCode),
            where("status", "==", "pending")
        );
        const snapshot = await getDocs(invitesQuery);
        const invites = [];
        snapshot.forEach((inviteDoc) => {
            invites.push({ id: inviteDoc.id, ...inviteDoc.data() });
        });

        if (invites.length === 0) {
            pendingInvitesList.innerHTML = '<p class="muted-text">No pending invites.</p>';
            return;
        }

        invites.forEach((invite) => {
            const item = document.createElement('div');
            item.className = 'pending-invite-item';
            item.innerHTML = `
                <span>${invite.recipientEmail}</span>
                <button type="button" class="danger-small">Cancel</button>
            `;
            item.querySelector('button').addEventListener('click', () => cancelInvite(invite.id));
            pendingInvitesList.appendChild(item);
        });
    } catch (error) {
        console.error("Error rendering pending invites:", error);
        pendingInvitesList.innerHTML = '<p class="form-message">Failed to load pending invites.</p>';
    }
}

async function cancelInvite(inviteId) {
    return window.withButtonLock(null, async () => {
    if (!isCurrentUserTeacher()) return;

    try {
        await updateDoc(doc(db, INVITES_COLLECTION, inviteId), {
            status: "cancelled",
            updatedAt: new Date()
        });
        await renderPendingInvites();
    } catch (error) {
        console.error("Error cancelling invite:", error);
        alert("Failed to cancel invite: " + error.message);
    }
    });
}

async function kickStudent(student) {
    return window.withButtonLock(null, async () => {
    if (!isCurrentUserTeacher()) return;
    if (!await window.appConfirm(`Remove ${student.name} from this class?`, { title: 'Remove student' })) return;

    const classCode = getClassCodeFromUrl();
    try {
        const classRef = doc(db, CLASSES_COLLECTION, classCode);
        const classSnap = await getDoc(classRef);
        if (!classSnap.exists()) {
            alert("Class not found.");
            return;
        }

        const classData = classSnap.data();
        const members = Array.isArray(classData.members) ? classData.members : [];
        const studentEmail = (student.email || '').toLowerCase();
        const nextMembers = members.filter(member => {
            const memberEmail = (member.email || '').toLowerCase();
            return member.id !== student.id && (!studentEmail || memberEmail !== studentEmail);
        });

        if (nextMembers.length === members.length) {
            alert("Could not find this student in the class anymore.");
            await loadClassData(classCode);
            await displayClassMembers();
            return;
        }

        await updateDoc(classRef, {
            members: nextMembers,
            updatedAt: new Date()
        });
        await loadClassData(classCode);
        await displayClassMembers();
    } catch (error) {
        console.error("Error kicking student:", error);
        alert("Failed to remove student: " + error.message);
    }
    });
}

function updateStreamHeader() {
    const streamTitle = document.getElementById('stream_text');
    const streamMeta = document.getElementById('streamMetaText');
    const composerAvatar = document.getElementById('streamComposerAvatar');
    const profile = getCurrentMemberProfile();

    if (streamTitle) {
        streamTitle.textContent = currentClassData?.className
            ? `Welcome to ${currentClassData.className}!`
            : 'Welcome to class!';
    }

    if (streamMeta) {
        streamMeta.textContent = currentClassData?.subject || 'Share announcements, questions, and updates with your class.';
    }

    if (composerAvatar) {
        composerAvatar.textContent = getInitials(profile.name || currentUser?.name || 'User');
        composerAvatar.setAttribute('aria-label', `${profile.name || 'Your'} avatar`);
    }
}

async function loadStreamPosts() {
    const classCode = getClassCodeFromUrl();
    const feed = document.getElementById('streamFeed');
    if (!classCode || !feed) return;

    updateStreamHeader();
    feed.innerHTML = '<div class="stream-loading">Loading stream...</div>';

    try {
        const postsSnapshot = await getDocs(query(collection(db, CLASSES_COLLECTION, classCode, STREAM_POSTS_SUBCOLLECTION)));
        const posts = [];

        for (const postDoc of postsSnapshot.docs) {
            const commentsSnapshot = await getDocs(query(collection(
                db,
                CLASSES_COLLECTION,
                classCode,
                STREAM_POSTS_SUBCOLLECTION,
                postDoc.id,
                STREAM_COMMENTS_SUBCOLLECTION
            )));
            const comments = [];
            commentsSnapshot.forEach(commentDoc => {
                comments.push({ id: commentDoc.id, ...commentDoc.data() });
            });
            comments.sort((a, b) => {
                const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
                const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
                return aTime - bTime;
            });
            posts.push({ id: postDoc.id, ...postDoc.data(), comments });
        }

        posts.sort((a, b) => {
            const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
            const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
            return bTime - aTime;
        });

        streamPostsCache = posts;
        renderStreamPosts(posts);
    } catch (error) {
        console.error("Error loading stream posts:", error);
        feed.innerHTML = '<div class="stream-empty">Could not load class stream. Please try again.</div>';
    }
}

function renderStreamPosts(posts) {
    const feed = document.getElementById('streamFeed');
    if (!feed) return;

    feed.innerHTML = '';
    if (!posts.length) {
        feed.innerHTML = `
            <div class="stream-empty">
                <strong>No posts yet.</strong>
                <span>Start the conversation with your class.</span>
            </div>
        `;
        return;
    }

    posts.forEach(post => {
        const article = document.createElement('article');
        article.className = 'stream-post-card';
        article.dataset.postId = post.id;
        const canDeletePost = isCurrentUserTeacher() || post.authorId === currentUser?.uid;
        const comments = Array.isArray(post.comments) ? post.comments : [];

        article.innerHTML = `
            <header class="stream-post-header">
                <div class="stream-initials-avatar" aria-label="${escapeHtml(post.authorName || 'User')} avatar">${escapeHtml(getInitials(post.authorName || 'User'))}</div>
                <div>
                    <strong>${escapeHtml(post.authorName || 'User')}</strong>
                    <span>${escapeHtml(post.authorRole || 'member')} • ${formatStreamDate(post.createdAt)}</span>
                </div>
                ${canDeletePost ? '<button type="button" class="stream-delete-post">Delete</button>' : ''}
            </header>
            <p class="stream-post-content">${escapeHtml(post.content || '').replace(/\n/g, '<br>')}</p>
            <div class="stream-comments"></div>
            <form class="stream-comment-form">
                <div class="stream-initials-avatar stream-initials-avatar-sm" aria-label="Your avatar">${escapeHtml(getInitials(getCurrentMemberProfile().name || 'User'))}</div>
                <input type="text" placeholder="Add class comment..." maxlength="600">
                <button type="submit">Send</button>
            </form>
        `;

        const commentsContainer = article.querySelector('.stream-comments');
        comments.forEach(comment => {
            commentsContainer.appendChild(buildCommentElement(post.id, comment));
        });

        article.querySelector('.stream-delete-post')?.addEventListener('click', () => deleteStreamPost(post.id));
        article.querySelector('.stream-comment-form')?.addEventListener('submit', (event) => submitStreamComment(event, post.id));
        feed.appendChild(article);
    });
}

function buildCommentElement(postId, comment) {
    const item = document.createElement('div');
    item.className = 'stream-comment';
    const canDeleteComment = isCurrentUserTeacher() || comment.authorId === currentUser?.uid;
    item.innerHTML = `
        <div class="stream-initials-avatar stream-initials-avatar-sm" aria-label="${escapeHtml(comment.authorName || 'User')} avatar">${escapeHtml(getInitials(comment.authorName || 'User'))}</div>
        <div class="stream-comment-bubble">
            <div class="stream-comment-meta">
                <strong>${escapeHtml(comment.authorName || 'User')}</strong>
                <span>${formatStreamDate(comment.createdAt)}</span>
                ${canDeleteComment ? '<button type="button" class="stream-delete-comment">Delete</button>' : ''}
            </div>
            <p>${escapeHtml(comment.content || '').replace(/\n/g, '<br>')}</p>
        </div>
    `;
    item.querySelector('.stream-delete-comment')?.addEventListener('click', () => deleteStreamComment(postId, comment.id));
    return item;
}

async function submitStreamPost(event) {
    event.preventDefault();
    return window.withButtonLock(event.submitter || document.getElementById('streamPostButton'), async () => {
    const input = document.getElementById('streamPostInput');
    const button = document.getElementById('streamPostButton');
    const message = document.getElementById('streamPostMessage');
    const classCode = getClassCodeFromUrl();
    const content = input?.value.trim();
    if (!input || !classCode) return;

    if (!content) {
        if (message) message.textContent = 'Write something before posting.';
        return;
    }

    const profile = getCurrentMemberProfile();
    try {
        if (message) message.textContent = '';
        await addDoc(collection(db, CLASSES_COLLECTION, classCode, STREAM_POSTS_SUBCOLLECTION), {
            content,
            authorId: currentUser.uid,
            authorName: profile.name,
            authorAvatar: profile.avatar,
            authorRole: profile.role,
            createdAt: new Date(),
            updatedAt: new Date()
        });
        input.value = '';
        input.style.height = '';
        await loadStreamPosts();
    } catch (error) {
        console.error("Error creating stream post:", error);
        if (message) message.textContent = 'Could not post. Please try again.';
    }
    });
}

async function submitStreamComment(event, postId) {
    event.preventDefault();
    return window.withButtonLock(event.submitter || event.currentTarget.querySelector('button[type="submit"]'), async () => {
    const form = event.currentTarget;
    const input = form.querySelector('input');
    const classCode = getClassCodeFromUrl();
    const content = input?.value.trim();
    if (!content || !classCode) return;

    const profile = getCurrentMemberProfile();
    try {
        await addDoc(collection(
            db,
            CLASSES_COLLECTION,
            classCode,
            STREAM_POSTS_SUBCOLLECTION,
            postId,
            STREAM_COMMENTS_SUBCOLLECTION
        ), {
            content,
            authorId: currentUser.uid,
            authorName: profile.name,
            authorAvatar: profile.avatar,
            authorRole: profile.role,
            createdAt: new Date()
        });
        input.value = '';
        await loadStreamPosts();
    } catch (error) {
        console.error("Error creating stream comment:", error);
        alert("Could not send comment: " + error.message);
    }
    });
}

async function deleteStreamPost(postId) {
    return window.withButtonLock(null, async () => {
    if (!postId || !await window.appConfirm("Delete this post?", { title: 'Delete post' })) return;
    const classCode = getClassCodeFromUrl();
    const post = streamPostsCache.find(item => item.id === postId);
    if (!isCurrentUserTeacher() && post?.authorId !== currentUser?.uid) return;

    try {
        const comments = Array.isArray(post?.comments) ? post.comments : [];
        await Promise.all(comments.map(comment => deleteDoc(doc(
            db,
            CLASSES_COLLECTION,
            classCode,
            STREAM_POSTS_SUBCOLLECTION,
            postId,
            STREAM_COMMENTS_SUBCOLLECTION,
            comment.id
        ))));
        await deleteDoc(doc(db, CLASSES_COLLECTION, classCode, STREAM_POSTS_SUBCOLLECTION, postId));
        await loadStreamPosts();
    } catch (error) {
        console.error("Error deleting stream post:", error);
        alert("Could not delete post: " + error.message);
    }
    });
}

async function deleteStreamComment(postId, commentId) {
    return window.withButtonLock(null, async () => {
    if (!postId || !commentId) return;
    const classCode = getClassCodeFromUrl();
    const post = streamPostsCache.find(item => item.id === postId);
    const comment = post?.comments?.find(item => item.id === commentId);
    if (!isCurrentUserTeacher() && comment?.authorId !== currentUser?.uid) return;

    try {
        await deleteDoc(doc(
            db,
            CLASSES_COLLECTION,
            classCode,
            STREAM_POSTS_SUBCOLLECTION,
            postId,
            STREAM_COMMENTS_SUBCOLLECTION,
            commentId
        ));
        await loadStreamPosts();
    } catch (error) {
        console.error("Error deleting stream comment:", error);
        alert("Could not delete comment: " + error.message);
    }
    });
}


async function loadClassData(classCode) {
    try {
        const classDocRef = doc(db, CLASSES_COLLECTION, classCode);
        const classDocSnap = await getDoc(classDocRef);

        if (classDocSnap.exists()) {
            currentClassData = { id: classDocSnap.id, ...classDocSnap.data() };
            console.log("Class data loaded from Firestore:", currentClassData);

            const members = Array.isArray(currentClassData.members) ? currentClassData.members : [];
            const isMember = members.some(member => member.id === currentUser.uid);
            if (!isMember) {
                alert("You are not a member of this class.");
                window.location.replace('dashboard.html');
                return false; 
            }
            return true; 
        } else {
            console.error("Class not found for code:", classCode);
            alert("Class not found or you don't have access.");
            window.location.replace('dashboard.html');
            return false;
        }
    } catch (error) {
        console.error("Error loading class data from Firestore:", error);
        alert("Error loading class data: " + error.message);
        window.location.replace('dashboard.html');
        return false;
    }
}

function openAccountSettingsModal() {
    const modal = document.getElementById('accountSettingsModal');
    const message = document.getElementById('accountSettingsMessage');
    if (!modal || !currentUser) return;

    document.getElementById('accountFirstname').value = currentUser.firstname || '';
    document.getElementById('accountCurrentPassword').value = '';
    document.getElementById('accountPassword').value = '';
    document.getElementById('accountConfirmPassword').value = '';
    if (message) {
        message.textContent = '';
        message.className = 'settings-message';
    }
    modal.classList.remove('hidden');
}

function closeAccountSettingsModal() {
    const modal = document.getElementById('accountSettingsModal');
    const form = document.getElementById('accountSettingsForm');
    const message = document.getElementById('accountSettingsMessage');
    modal?.classList.add('hidden');
    form?.reset();
    if (message) {
        message.textContent = '';
        message.className = 'settings-message';
    }
}

async function updateCurrentUserMemberName(firstname) {
    const classCode = getClassCodeFromUrl();
    if (!classCode || !currentClassData) return;

    const newName = firstname;
    const members = Array.isArray(currentClassData.members) ? currentClassData.members : [];
    const nextMembers = members.map(member => (
        member.id === currentUser.uid
            ? { ...member, name: newName, avatar: currentUser.avatar || member.avatar || 'account.png' }
            : member
    ));
    const changed = JSON.stringify(members) !== JSON.stringify(nextMembers);
    if (!changed) return;

    await updateDoc(doc(db, CLASSES_COLLECTION, classCode), {
        members: nextMembers,
        updatedAt: new Date()
    });
    currentClassData = { ...currentClassData, members: nextMembers };
}

async function saveAccountSettings(event) {
    event.preventDefault();
    return window.withButtonLock(event.submitter || document.getElementById('saveAccountSettingsButton'), async () => {
    if (!currentUser || !auth.currentUser) return;

    const firstname = document.getElementById('accountFirstname').value.trim();
    const currentPassword = document.getElementById('accountCurrentPassword').value;
    const newPassword = document.getElementById('accountPassword').value;
    const confirmPassword = document.getElementById('accountConfirmPassword').value;
    const message = document.getElementById('accountSettingsMessage');
    const wantsPasswordChange = Boolean(currentPassword || newPassword || confirmPassword);

    message.className = 'settings-message error';
    if (!firstname) {
        message.textContent = 'Username is required.';
        return;
    }
    if (wantsPasswordChange) {
        if (!currentPassword) {
            message.textContent = 'Current password is required.';
            return;
        }
        if (!newPassword) {
            message.textContent = 'New password is required.';
            return;
        }
        if (newPassword === currentPassword) {
            message.textContent = 'New password must be different from your current password.';
            return;
        }
        if (!confirmPassword) {
            message.textContent = 'Confirm new password is required.';
            return;
        }
        if (newPassword !== confirmPassword) {
            message.textContent = 'Passwords do not match.';
            return;
        }
        if (newPassword.length < 6) {
            message.textContent = 'Password must be at least 6 characters.';
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
        await updateCurrentUserMemberName(firstname);

        if (wantsPasswordChange) {
            await updatePassword(auth.currentUser, newPassword);
        }

        message.className = 'settings-message success';
        message.textContent = 'Account updated.';
        document.getElementById('accountCurrentPassword').value = '';
        document.getElementById('accountPassword').value = '';
        document.getElementById('accountConfirmPassword').value = '';
        if (!document.getElementById('people')?.classList.contains('hidden')) {
            await displayClassMembers();
        }
        closeAccountSettingsModal();
    } catch (error) {
        console.error("Error updating account settings:", error);
        message.className = 'settings-message error';
        if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
            message.textContent = 'Current password is incorrect.';
        } else if (error.code === 'auth/requires-recent-login') {
            message.textContent = 'Please log out and log in again before changing your password.';
        } else {
            message.textContent = 'Failed to update account: ' + error.message;
        }
    }
    });
}


document.addEventListener('DOMContentLoaded', async () => {
    showClassLoader();
    const displayClassName = document.getElementById('displayClassName');
    const displaySection = document.getElementById('displaySection');
    const displaySubject = document.getElementById('displaySubject');
    const displayRoom = document.getElementById('displayRoom');
    const displayClassCode = document.getElementById('displayClassCode');
    const breadcrumbClassName = document.getElementById('breadcrumbClassName');
    const sendInviteButton = document.getElementById('sendInviteButton');
    const createFolderButton = document.getElementById('createFolderButton');
    const classworkSearchInput = document.getElementById('classworkSearchInput');
    const peopleSearchInput = document.getElementById('peopleSearchInput');
    const streamPostForm = document.getElementById('streamPostForm');
    const streamPostInput = document.getElementById('streamPostInput');
    const copyClassCodeButton = document.getElementById('copyClassCodeButton');

    const urlParams = new URLSearchParams(window.location.search);
    const classCode = urlParams.get('classCode');

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            console.log("User logged in:", user.uid);
            const userDocRef = doc(db, USERS_COLLECTION, user.uid);
            const userDocSnap = await getDoc(userDocRef);

            if (userDocSnap.exists()) {
                currentUser = { uid: user.uid, ...userDocSnap.data() };
                console.log("Current user profile loaded:", currentUser);

              
                const classLoaded = await loadClassData(classCode);
                if (classLoaded) {
                   
                    displayClassName.textContent = currentClassData.className || 'N/A';
                    displaySection.textContent = currentClassData.section || 'N/A';
                    displaySubject.textContent = currentClassData.subject || 'N/A';
                    displayRoom.textContent = currentClassData.room || 'N/A';
                    displayClassCode.textContent = currentClassData.classCode || 'N/A';
                    breadcrumbClassName.textContent = currentClassData.className || 'Class Name';
                    updateTeacherOnlyControls();

                    const tabParam = urlParams.get('tab');
                    await showTabContent(tabParam || 'stream');
                }
            } else {
                console.warn("User profile not found in Firestore for UID:", user.uid);
                alert("Your user profile could not be loaded. Please try logging in again.");
                window.location.replace('index.html');
            }
        } else {
            console.log("User not logged in, redirecting to index.html");
            window.location.replace('index.html');
        }
    });


    const avatar = document.getElementById('avatar');
    const avatarMenu = document.getElementById('avatarMenu');
    const accountSettingsButton = document.getElementById('accountSettingsButton');
    const logoutButton = document.getElementById('logoutButton');
    const accountSettingsForm = document.getElementById('accountSettingsForm');
    const cancelAccountSettings = document.getElementById('cancelAccountSettings');

    avatar.addEventListener('click', (e) => {
        avatarMenu.classList.toggle('hidden');
        e.stopPropagation();
    });

    document.addEventListener('click', () => {
        avatarMenu.classList.add('hidden');
    });

    avatarMenu.addEventListener('click', (e) => e.stopPropagation());

    accountSettingsButton?.addEventListener('click', (e) => {
        e.stopPropagation();
        avatarMenu.classList.add('hidden');
        openAccountSettingsModal();
    });

    cancelAccountSettings?.addEventListener('click', closeAccountSettingsModal);
    accountSettingsForm?.addEventListener('submit', saveAccountSettings);

    logoutButton.addEventListener('click', async (event) => {
        return window.withButtonLock(event, async () => {
        try {
            await signOut(auth); 
            console.log("User signed out successfully.");
            window.location.href = 'index.html';
        } catch (error) {
            console.error("Error signing out:", error);
            alert("Error signing out: " + error.message);
        }
        });
    });

    if (sendInviteButton) {
        sendInviteButton.addEventListener('click', sendStudentInvite);
    }

    if (createFolderButton) {
        createFolderButton.addEventListener('click', createTestFolder);
    }

    if (classworkSearchInput) {
        classworkSearchInput.addEventListener('input', (event) => {
            classworkSearchTerm = event.target.value.trim().toLowerCase();
            renderClasswork();
        });
    }

    if (peopleSearchInput) {
        peopleSearchInput.addEventListener('input', async (event) => {
            peopleSearchTerm = event.target.value.trim().toLowerCase();
            if (!document.getElementById('people')?.classList.contains('hidden')) {
                await displayClassMembers();
            }
        });
    }

    if (streamPostForm) {
        streamPostForm.addEventListener('submit', submitStreamPost);
    }

    if (streamPostInput) {
        streamPostInput.addEventListener('input', () => {
            streamPostInput.style.height = 'auto';
            streamPostInput.style.height = `${Math.min(streamPostInput.scrollHeight, 180)}px`;
        });
    }

    if (copyClassCodeButton) {
        copyClassCodeButton.addEventListener('click', async () => {
            const message = document.getElementById('copyClassCodeMessage');
            const code = currentClassData?.classCode || getClassCodeFromUrl();
            try {
                await navigator.clipboard.writeText(code);
                if (message) message.textContent = 'Copied.';
            } catch (error) {
                if (message) message.textContent = code;
            }
            setTimeout(() => {
                if (message) message.textContent = '';
            }, 1800);
        });
    }
});

function updateTeacherOnlyControls() {
    const inviteStudentPanel = document.getElementById('inviteStudentPanel');
    const createFolderButton = document.getElementById('createFolderButton');
    const isTeacher = isCurrentUserTeacher();

    if (inviteStudentPanel) {
        inviteStudentPanel.classList.toggle('hidden', !isTeacher);
    }
    if (createFolderButton) {
        createFolderButton.classList.toggle('hidden', !isTeacher);
    }
}


async function showTabContent(tabId) { // userRole sẽ được lấy từ currentUser
    if (!currentUser || !currentClassData) {
        console.warn("User or class data not loaded yet. Waiting to show tab content.");
        return; 
    }

    showClassLoader(tabId === 'grades' ? 'Loading grades...' : 'Loading class...');

    try {
        const members = Array.isArray(currentClassData.members) ? currentClassData.members : [];
        const userRole = members.find(member => member.id === currentUser.uid)?.role || 'student';
        
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => item.classList.remove('active'));
        const activeItem = document.querySelector(`.nav-item[onclick*="showPage('${tabId}')"]`);
        if (activeItem) {
            activeItem.classList.add('active');
        }

        const allPages = document.querySelectorAll('.page-section');
        allPages.forEach(p => p.classList.add('hidden'));

        const currentPageSection = document.getElementById(tabId);
        if (currentPageSection) {
            currentPageSection.classList.remove('hidden');
        }

        const urlParams = new URLSearchParams(window.location.search);
        const currentClassCode = urlParams.get('classCode');

        if (tabId === 'classwork') {
            const createButton = document.getElementById('createButton');
            const studentClassworkMessage = document.getElementById('studentClassworkMessage');
            const noTestsContentTitle = document.getElementById('text1');
            const noTestsContentDescription = document.getElementById('text2');
            const noTestsContentImage = document.getElementById('fox_image');

            if (userRole === 'teacher') {
                if (createButton) createButton.classList.remove('hidden');
                if (studentClassworkMessage) studentClassworkMessage.classList.add('hidden');
                if (noTestsContentTitle) noTestsContentTitle.textContent = "This is where you'll assign and receive work!";
                if (noTestsContentDescription) noTestsContentDescription.textContent = "You can add assignments and other work for the class, then organize it into topics.";
                if (noTestsContentImage) noTestsContentImage.src = "PNG/fox.jpg";
            } else { // student
                if (createButton) createButton.classList.add('hidden');
                if (studentClassworkMessage) {
                    studentClassworkMessage.classList.remove('hidden');
                }
                if (noTestsContentTitle) noTestsContentTitle.textContent = "Your assignments will appear here!";
                if (noTestsContentDescription) noTestsContentDescription.textContent = "Stay tuned for new tasks from your teacher.";
                if (noTestsContentImage) noTestsContentImage.src = "PNG/fox.jpg";
            }

            if (typeof loadTestsForCurrentClass === 'function') {
                await loadTestsForCurrentClass(currentClassCode);
            } else {
                console.error("loadTestsForCurrentClass function not found. Make sure it's imported or globally available.");
            }
        } else if (tabId === 'grades') {
            if (typeof loadGradesForClass === 'function') {
                await loadGradesForClass();
            } else {
                console.warn("loadGradesForClass function not found. Skipping grade loading.");
            }
        } else if (tabId === 'people') {
            console.log("DEBUG: Calling displayClassMembers for tab 'people'.");
            await displayClassMembers(); 
        } else if (tabId === 'stream') {
            await loadStreamPosts();
        }
    } finally {
        hideClassLoader();
    }
}

function goToCreateTest() {
    const urlParams = new URLSearchParams(window.location.search);
    const classCode = urlParams.get('classCode');
    const folderId = arguments[0] || null;
    const folderWarning = document.getElementById('classworkFolderWarning');

    if (!folderId && currentClassFolders.length === 0) {
        if (folderWarning) {
            folderWarning.textContent = 'Please create a folder before creating a test.';
            folderWarning.classList.remove('hidden');
        }
        return;
    }

    if (classCode) {
        saveOpenClassworkFoldersForReturn(classCode);
        const folderParam = folderId ? `&folderId=${encodeURIComponent(folderId)}` : '';
        window.location.href = `create.html?classCode=${classCode}${folderParam}`;
    } else {
        alert("Cannot create test: Class code not found.");
        window.location.href = 'dashboard.html';
    }
}



async function loadTestsForCurrentClass(currentClassCode) {
    if (!currentUser || !currentClassData) {
        console.warn("User or class data not loaded, cannot load tests.");
        return;
    }

    const testListContainer = document.getElementById('test-list');
    const noTestsContent = document.getElementById('noTestsContent');

    if (!testListContainer || !noTestsContent) {
        console.warn("Required elements not found. Cannot load tests.");
        return;
    }

    testListContainer.innerHTML = '';
    await loadFoldersForCurrentClass(currentClassCode);

    const testsRef = collection(db, CLASSES_COLLECTION, currentClassCode, TESTS_SUBCOLLECTION);
    const q = query(testsRef);
    const querySnapshot = await getDocs(q);
    currentClassTests = [];

    querySnapshot.forEach((doc) => {
        const test = { id: doc.id, ...doc.data() };
        if (isTestVisibleToCurrentUser(test)) {
            currentClassTests.push(test);
        }
    });

    restoreOpenClassworkFoldersForReturn(currentClassCode);
    renderClasswork();
}

async function loadFoldersForCurrentClass(currentClassCode) {
    const foldersRef = collection(db, CLASSES_COLLECTION, currentClassCode, TEST_FOLDERS_SUBCOLLECTION);
    const folderSnapshot = await getDocs(query(foldersRef));
    currentClassFolders = [];
    folderSnapshot.forEach((folderDoc) => {
        currentClassFolders.push({ id: folderDoc.id, ...folderDoc.data() });
    });
    currentClassFolders.sort((a, b) => {
        const aHasOrder = typeof a.order === 'number';
        const bHasOrder = typeof b.order === 'number';
        if (aHasOrder && bHasOrder) return a.order - b.order;
        if (aHasOrder) return -1;
        if (bHasOrder) return 1;
        return (a.name || '').localeCompare(b.name || '');
    });
}

function renderClasswork() {
    const userRole = getCurrentUserRole();
    const testListContainer = document.getElementById('test-list');
    const noTestsContent = document.getElementById('noTestsContent');
    const folderWarning = document.getElementById('classworkFolderWarning');
    if (!testListContainer || !noTestsContent) return;

    testListContainer.innerHTML = '';
    if (folderWarning) {
        if (userRole === 'teacher' && currentClassFolders.length === 0) {
            folderWarning.textContent = 'Please create a folder before creating a test.';
            folderWarning.classList.remove('hidden');
        } else {
            folderWarning.textContent = '';
            folderWarning.classList.add('hidden');
        }
    }

    if (currentClassTests.length === 0 && currentClassFolders.length === 0) {
        testListContainer.classList.add('hidden');
        noTestsContent.classList.remove('hidden');
        if (userRole === 'teacher') {
            document.getElementById('text1').textContent = "This is where you'll assign and receive work!";
            document.getElementById('text2').textContent = "You can add assignments and other work for the class, then organize it into topics.";
        } else {
            document.getElementById('text1').textContent = "Your assignments will appear here!";
            document.getElementById('text2').textContent = "Stay tuned for new tasks from your teacher.";
        }
        return;
    } else {
        testListContainer.classList.remove('hidden');
        noTestsContent.classList.add('hidden');
    }

    const groupedFolders = [
        ...currentClassFolders.map(folder => ({ ...folder, isUnfiled: false })),
        { id: UNFILED_FOLDER_ID, name: 'Unfiled', isUnfiled: true }
    ];
    let renderedAny = false;
    const now = new Date();

    groupedFolders.forEach((folder) => {
        const folderId = folder.isUnfiled ? null : folder.id;
        const folderTests = getTestsForFolder(folderId);

        if (folder.isUnfiled && folderTests.length === 0) {
            return;
        }

        const folderMatches = !classworkSearchTerm || (folder.name || '').toLowerCase().includes(classworkSearchTerm);
        const filteredTests = folderTests.filter(test => {
            if (!classworkSearchTerm || folderMatches) return true;
            return (test.title || '').toLowerCase().includes(classworkSearchTerm);
        });

        if (userRole !== 'teacher' && filteredTests.length === 0) {
            return;
        }

        if (filteredTests.length === 0 && !folderMatches) {
            return;
        }

        renderedAny = true;
        const folderSection = document.createElement('section');
        folderSection.className = 'test-folder-section';
        folderSection.dataset.folderId = folder.id;
        folderSection.dataset.dropFolderId = folder.isUnfiled ? '' : folder.id;
        folderSection.innerHTML = `
            <div class="test-folder-header">
                <button type="button" class="folder-toggle">▾</button>
                <h3>${folder.name}</h3>
                <span>${filteredTests.length} test${filteredTests.length === 1 ? '' : 's'}</span>
                ${userRole === 'teacher' && !folder.isUnfiled ? `
                    <button type="button" class="folder-add-test-btn">+ Test</button>
                    <button type="button" class="folder-rename-btn">Rename</button>
                    <button type="button" class="folder-delete-btn">Delete</button>
                ` : ''}
            </div>
            <div class="test-folder-body"></div>
        `;

        const body = folderSection.querySelector('.test-folder-body');
        folderSection.querySelector('.folder-toggle').addEventListener('click', (event) => {
            body.classList.toggle('hidden');
            event.currentTarget.textContent = body.classList.contains('hidden') ? '▸' : '▾';
        });
        folderSection.querySelector('.folder-add-test-btn')?.addEventListener('click', () => goToCreateTest(folder.id));
        folderSection.querySelector('.folder-rename-btn')?.addEventListener('click', () => renameTestFolder(folder));
        folderSection.querySelector('.folder-delete-btn')?.addEventListener('click', () => deleteTestFolder(folder));
        setupClassworkDragAndDrop(folderSection, folder);

        if (filteredTests.length === 0) {
            body.innerHTML = '<p class="muted-text">No tests in this folder.</p>';
        } else {
            filteredTests.forEach(test => {
                body.appendChild(buildTestItem(test, now, folderId));
            });
        }
        if (collapseClassworkAfterNextRender || !preserveClassworkOpenStateAfterNextRender) {
            body.classList.add('hidden');
            const toggle = folderSection.querySelector('.folder-toggle');
            if (toggle) toggle.textContent = '▸';
        } else if (preserveClassworkOpenStateAfterNextRender && !openClassworkFolderIds.has(folder.id)) {
            body.classList.add('hidden');
            const toggle = folderSection.querySelector('.folder-toggle');
            if (toggle) toggle.textContent = '▸';
        }
        testListContainer.appendChild(folderSection);
    });

    if (!renderedAny) {
        if (!classworkSearchTerm && userRole !== 'teacher') {
            testListContainer.classList.add('hidden');
            noTestsContent.classList.remove('hidden');
            document.getElementById('text1').textContent = "Your assignments will appear here!";
            document.getElementById('text2').textContent = "Stay tuned for new tasks from your teacher.";
        } else {
            testListContainer.innerHTML = '<p class="empty-search-message">No folders or tests match your search.</p>';
        }
    }
    collapseClassworkAfterNextRender = false;
    preserveClassworkOpenStateAfterNextRender = false;
}

function buildTestItem(test, now, folderId = null) {
    const userRole = getCurrentUserRole();
    const currentClassCode = getClassCodeFromUrl();
    let testStatus = '';
    let buttonHTML = '';

    const startTime = test.startTime ? test.startTime.toDate() : null;
    const endTime = test.endTime ? test.endTime.toDate() : null;
    const formattedStartTime = startTime ? startTime.toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }) : 'N/A';
    const formattedEndTime = endTime ? endTime.toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }) : 'N/A';
    const dateRangeText = `Date: ${formattedStartTime} - ${formattedEndTime}`;
    const questionCount = getTestQuestionCount(test);
    const questionLabel = questionCount === 1 ? 'Question' : 'Questions';
    const timerText = test.timer > 0 ? `${test.timer} mins` : 'No timer';
    const assignmentText = test.assignedTo === 'selected' ? 'Assigned: Selected students' : 'Assigned: Everyone';

    if (userRole === 'teacher') {
        buttonHTML = `
            <button class="start-btn" onclick="startTest('${test.id}', '${currentClassCode}')">Start</button>
            <button class="edit-btn" onclick="editTest('${test.id}', '${currentClassCode}')">Edit</button>
            <button class="delete-btn" onclick="deleteTest('${test.id}', '${currentClassCode}')">Delete</button>
        `;
    } else {
        if (startTime && now < startTime) {
            testStatus = 'Not started yet';
            buttonHTML = `<button class="coming-soon-btn" disabled>Coming soon</button>`;
        } else if (!endTime || now <= endTime) {
            testStatus = 'Available';
            buttonHTML = `<button class="start-btn" onclick="startTest('${test.id}', '${currentClassCode}')">Start</button>`;
        } else {
            testStatus = 'Ended';
            buttonHTML = `<button class="start-btn" disabled>Ended</button>`;
        }
    }

    const div = document.createElement('div');
    div.className = 'test-item';
    div.dataset.testId = test.id;
    if (isCurrentUserTeacher() && !classworkSearchTerm) {
        div.draggable = true;
        div.classList.add('draggable-test');
        div.addEventListener('dragstart', (event) => {
            event.stopPropagation();
            div.classList.add('is-dragging');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', JSON.stringify({
                type: 'test',
                testId: test.id
            }));
        });
        div.addEventListener('dragend', () => {
            div.classList.remove('is-dragging');
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            clearTestDropIndicators();
        });
    }
    div.innerHTML = `
        <div class="test-card-main">
            <span class="test-card-kicker">IELTS Test</span>
            <h3 class="test-card-title">${escapeHtml(test.title || 'Untitled test')}</h3>
            <div class="test-card-meta">
                <span class="test-card-chip">${escapeHtml(dateRangeText)}</span>
                <span class="test-card-chip">${questionCount} ${questionLabel}</span>
                <span class="test-card-chip">Timer: ${escapeHtml(timerText)}</span>
                ${userRole === 'teacher' ? `<span class="test-card-chip">${escapeHtml(assignmentText)}</span>` : ''}
            </div>
            ${testStatus ? `<p class="test-status">${escapeHtml(testStatus)}</p>` : ''}
        </div>
        <div class="test-actions">
            ${buttonHTML}
        </div>`;
    return div;
}

function getTestQuestionCount(test) {
    const countQuestionPoints = (question) => {
        if (question?.type === 'multipleChoiceSection') {
            if (question.sectionMode === 'selectionSet') {
                return Array.isArray(question.correctAnswers) ? question.correctAnswers.length : 0;
            }
            return Array.isArray(question.items) ? question.items.length : 0;
        }
        if (question?.type === 'inlineBlankSection') {
            return Array.isArray(question.blanks) ? question.blanks.length : 0;
        }
        if (question?.type === 'dropdownSection') {
            return Array.isArray(question.rows) ? question.rows.length : 0;
        }
        return 1;
    };

    if (Array.isArray(test.parts) && test.parts.length > 0) {
        return test.parts.reduce((total, part) => {
            const questions = Array.isArray(part.questions) ? part.questions : [];
            return total + questions.reduce((partTotal, question) => partTotal + countQuestionPoints(question), 0);
        }, 0);
    }

    const questions = Array.isArray(test.questions) ? test.questions : [];
    return questions.reduce((total, question) => total + countQuestionPoints(question), 0);
}

function readDragPayload(event) {
    try {
        return JSON.parse(event.dataTransfer.getData('text/plain'));
    } catch (error) {
        return null;
    }
}

function clearTestDropIndicators() {
    document.querySelectorAll('.drop-before, .drop-after').forEach(el => {
        el.classList.remove('drop-before', 'drop-after');
    });
}

function getTestInsertIndexFromPointer(body, clientY) {
    const testItems = [...body.querySelectorAll('.test-item:not(.is-dragging)')];
    if (testItems.length === 0) return 0;

    for (let index = 0; index < testItems.length; index += 1) {
        const rect = testItems[index].getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) {
            return index;
        }
    }
    return testItems.length;
}

function showTestDropIndicator(body, insertIndex) {
    clearTestDropIndicators();
    const testItems = [...body.querySelectorAll('.test-item:not(.is-dragging)')];
    if (testItems.length === 0) return;
    if (insertIndex >= testItems.length) {
        testItems[testItems.length - 1].classList.add('drop-after');
    } else {
        testItems[insertIndex].classList.add('drop-before');
    }
}

function clearFolderDropIndicators() {
    document.querySelectorAll('.folder-drop-before, .folder-drop-after').forEach(el => {
        el.classList.remove('folder-drop-before', 'folder-drop-after');
    });
}

function getFolderInsertIndexFromPointer(container, clientX, clientY) {
    const folderSections = [...container.querySelectorAll('.test-folder-section.draggable-folder:not(.is-dragging)')];
    if (folderSections.length === 0) return 0;

    const rows = [];
    folderSections.forEach((section, index) => {
        const rect = section.getBoundingClientRect();
        let row = rows.find(item => Math.abs(item.top - rect.top) < 12);
        if (!row) {
            row = { top: rect.top, bottom: rect.bottom, items: [] };
            rows.push(row);
        }
        row.top = Math.min(row.top, rect.top);
        row.bottom = Math.max(row.bottom, rect.bottom);
        row.items.push({ section, index, rect });
    });

    rows.sort((a, b) => a.top - b.top);
    for (const row of rows) {
        row.items.sort((a, b) => a.rect.left - b.rect.left);
    }

    if (clientY < rows[0].top) return 0;

    for (const row of rows) {
        if (clientY <= row.bottom) {
            for (const item of row.items) {
                if (clientX < item.rect.left + item.rect.width / 2) {
                    return item.index;
                }
            }
            return row.items[row.items.length - 1].index + 1;
        }
    }

    return folderSections.length;
}

function showFolderDropIndicator(container, insertIndex) {
    clearFolderDropIndicators();
    const folderSections = [...container.querySelectorAll('.test-folder-section.draggable-folder:not(.is-dragging)')];
    if (folderSections.length === 0) return;
    if (insertIndex >= folderSections.length) {
        folderSections[folderSections.length - 1].classList.add('folder-drop-after');
    } else {
        folderSections[insertIndex].classList.add('folder-drop-before');
    }
}

function setupClassworkDragAndDrop(folderSection, folder) {
    if (!isCurrentUserTeacher()) return;
    const classCode = getClassCodeFromUrl();
    const body = folderSection.querySelector('.test-folder-body');

    if (!folder.isUnfiled && !classworkSearchTerm) {
        folderSection.draggable = true;
        folderSection.classList.add('draggable-folder');
        folderSection.addEventListener('dragstart', (event) => {
            if (event.target.closest('.test-item, button')) {
                event.preventDefault();
                return;
            }
            folderSection.classList.add('is-dragging');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', JSON.stringify({
                type: 'folder',
                folderId: folder.id
            }));
        });
        folderSection.addEventListener('dragend', () => {
            folderSection.classList.remove('is-dragging');
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            clearFolderDropIndicators();
        });
    }

    folderSection.addEventListener('dragover', (event) => {
        event.preventDefault();
        const payload = readDragPayload(event);
        if (payload?.type === 'test' && body) {
            const target = folder.isUnfiled ? folderSection : body;
            target.classList.add('drag-over');
            showTestDropIndicator(body, getTestInsertIndexFromPointer(body, event.clientY));
        } else if (payload?.type === 'folder' && !classworkSearchTerm) {
            const testListContainer = document.getElementById('test-list');
            showFolderDropIndicator(testListContainer, getFolderInsertIndexFromPointer(testListContainer, event.clientX, event.clientY));
        }
    });

    folderSection.addEventListener('dragleave', (event) => {
        if (!folderSection.contains(event.relatedTarget)) {
            folderSection.classList.remove('drag-over');
            body?.classList.remove('drag-over');
            clearTestDropIndicators();
            clearFolderDropIndicators();
        }
    });

    folderSection.addEventListener('drop', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        folderSection.classList.remove('drag-over');
        body?.classList.remove('drag-over');
        clearTestDropIndicators();
        clearFolderDropIndicators();

        const payload = readDragPayload(event);
        if (!payload) return;

        if (payload.type === 'test') {
            const insertIndex = body ? getTestInsertIndexFromPointer(body, event.clientY) : 0;
            await reorderTest(payload.testId, folder.isUnfiled ? null : folder.id, insertIndex, classCode);
        } else if (payload.type === 'folder' && !classworkSearchTerm) {
            const testListContainer = document.getElementById('test-list');
            const insertIndex = getFolderInsertIndexFromPointer(testListContainer, event.clientX, event.clientY);
            await reorderFolder(payload.folderId, insertIndex, classCode);
        }
    });
}

async function reorderTest(testId, folderId, targetIndex, classCode) {
    const test = currentClassTests.find(item => item.id === testId);
    if (!test) return;

    const sourceFolderId = test.folderId || null;
    const nextTargetTests = getTestsForFolder(folderId).filter(item => item.id !== testId);
    const insertIndex = Math.max(0, Math.min(
        typeof targetIndex === 'number' ? targetIndex : nextTargetTests.length,
        nextTargetTests.length
    ));
    nextTargetTests.splice(insertIndex, 0, { ...test, folderId: folderId || null });

    const updatesByTestId = new Map();
    nextTargetTests.forEach((item, index) => {
        updatesByTestId.set(item.id, {
            folderId: folderId || null,
            order: index,
            updatedAt: new Date()
        });
    });

    if (getFolderKey(sourceFolderId) !== getFolderKey(folderId)) {
        getTestsForFolder(sourceFolderId)
            .filter(item => item.id !== testId)
            .forEach((item, index) => {
                updatesByTestId.set(item.id, {
                    folderId: sourceFolderId || null,
                    order: index,
                    updatedAt: new Date()
                });
            });
    }

    try {
        await Promise.all([...updatesByTestId.entries()].map(([updatedTestId, updates]) => updateDoc(
            doc(db, CLASSES_COLLECTION, classCode, TESTS_SUBCOLLECTION, updatedTestId),
            updates
        )));
        currentClassTests = currentClassTests.map(item => {
            const updates = updatesByTestId.get(item.id);
            return updates ? { ...item, ...updates } : item;
        });
        collapseClassworkAfterNextRender = true;
        renderClasswork();
    } catch (error) {
        console.error("Error reordering test:", error);
        alert("Failed to reorder test: " + error.message);
    }
}

async function reorderFolder(draggedFolderId, targetIndex, classCode) {
    const fromIndex = currentClassFolders.findIndex(folder => folder.id === draggedFolderId);
    if (fromIndex < 0) return;

    const nextFolders = [...currentClassFolders];
    const [draggedFolder] = nextFolders.splice(fromIndex, 1);
    let insertIndex = Math.max(0, Math.min(
        typeof targetIndex === 'number' ? targetIndex : nextFolders.length,
        nextFolders.length
    ));
    nextFolders.splice(insertIndex, 0, draggedFolder);
    if (nextFolders.every((folder, index) => folder.id === currentClassFolders[index]?.id)) return;

    try {
        await Promise.all(nextFolders.map((folder, index) => updateDoc(
            doc(db, CLASSES_COLLECTION, classCode, TEST_FOLDERS_SUBCOLLECTION, folder.id),
            { order: index, updatedAt: new Date() }
        )));
        currentClassFolders = nextFolders.map((folder, index) => ({ ...folder, order: index }));
        collapseClassworkAfterNextRender = true;
        renderClasswork();
    } catch (error) {
        console.error("Error reordering folders:", error);
        alert("Failed to reorder folders: " + error.message);
    }
}

async function createTestFolder() {
    return window.withButtonLock(null, async () => {
    if (!isCurrentUserTeacher()) return;
    const classCode = getClassCodeFromUrl();
    const name = await window.appPrompt("Folder name:", '', { title: 'Create folder' });
    if (!name || !name.trim()) return;

    try {
        await addDoc(collection(db, CLASSES_COLLECTION, classCode, TEST_FOLDERS_SUBCOLLECTION), {
            name: name.trim(),
            createdBy: currentUser.uid,
            order: currentClassFolders.length,
            createdAt: new Date(),
            updatedAt: new Date()
        });
        collapseClassworkAfterNextRender = true;
        await loadTestsForCurrentClass(classCode);
    } catch (error) {
        console.error("Error creating folder:", error);
        alert("Failed to create folder: " + error.message);
    }
    });
}

async function renameTestFolder(folder) {
    return window.withButtonLock(null, async () => {
    if (!isCurrentUserTeacher()) return;
    const classCode = getClassCodeFromUrl();
    const newName = await window.appPrompt("New folder name:", folder.name || '', { title: 'Rename folder' });
    if (!newName || !newName.trim()) return;

    try {
        await updateDoc(doc(db, CLASSES_COLLECTION, classCode, TEST_FOLDERS_SUBCOLLECTION, folder.id), {
            name: newName.trim(),
            updatedAt: new Date()
        });
        collapseClassworkAfterNextRender = true;
        await loadTestsForCurrentClass(classCode);
    } catch (error) {
        console.error("Error renaming folder:", error);
        alert("Failed to rename folder: " + error.message);
    }
    });
}

async function deleteTestFolder(folder) {
    return window.withButtonLock(null, async () => {
    if (!isCurrentUserTeacher()) return;
    const classCode = getClassCodeFromUrl();
    if (!await window.appConfirm(`Delete folder "${folder.name}"? Tests inside will move to Unfiled.`, { title: 'Delete folder' })) return;

    try {
        const testsInFolder = currentClassTests.filter(test => test.folderId === folder.id);
        await Promise.all(testsInFolder.map(test => updateDoc(
            doc(db, CLASSES_COLLECTION, classCode, TESTS_SUBCOLLECTION, test.id),
            { folderId: null, updatedAt: new Date() }
        )));
        await deleteDoc(doc(db, CLASSES_COLLECTION, classCode, TEST_FOLDERS_SUBCOLLECTION, folder.id));
        collapseClassworkAfterNextRender = true;
        await loadTestsForCurrentClass(classCode);
    } catch (error) {
        console.error("Error deleting folder:", error);
        alert("Failed to delete folder: " + error.message);
    }
    });
}


function startTest(id, classCode) {
    location.href = `exam.html?classCode=${classCode}&testId=${id}`; 
}

function editTest(id, classCode) {
    location.href = `create.html?classCode=${classCode}&testId=${id}`; 
}

async function deleteTest(id, classCode) {
    return window.withButtonLock(null, async () => {
    if (!await window.appConfirm("Are you sure you want to delete this test?", { title: 'Delete test' })) return;

    try {
        const testDocRef = doc(db, CLASSES_COLLECTION, classCode, TESTS_SUBCOLLECTION, id);
        captureOpenClassworkFolders();
        await deleteDoc(testDocRef);
        console.log("Test deleted successfully from Firestore:", id);
        
        preserveClassworkOpenStateAfterNextRender = true;
        await loadTestsForCurrentClass(classCode);

    } catch (error) {
        console.error("Error deleting test from Firestore:", error);
        alert("Failed to delete test: " + error.message);
    }
    });
}

window.goToCreateTest = goToCreateTest;
window.showPage = async (tabId) => {
    await showTabContent(tabId);
};
window.startTest = startTest;
window.editTest = editTest;
window.deleteTest = deleteTest;
