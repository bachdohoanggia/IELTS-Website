// validation.js

// Firebase SDK imports
import { auth, db } from "./firebase.js";
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
    doc,
    setDoc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// Constants for Firestore collection names
const USERS_COLLECTION = "users";
const APP_SETTINGS_COLLECTION = "appSettings";
const TEACHER_CODE_DOC_ID = "teacherCode";

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('form');
    const firstname_input = document.getElementById('firstname-input');
    const email_input = document.getElementById('email-input');
    const password_input = document.getElementById('password-input');
    const repeat_password_input = document.getElementById('repeat-password-input');
    const error_message = document.getElementById('error-message');
    const role_select = document.getElementById('role-select');

    const teacherCodePinModalOverlay = document.getElementById('teacherCodePinModalOverlay');
    const pinInputContainer = document.getElementById('pinInputContainer');
    const pinInputBoxes = pinInputContainer ? Array.from(pinInputContainer.querySelectorAll('.pin-input-box')) : [];
    const teacherCodePinModalError = document.getElementById('teacherCodePinModalError');
    const teacherCodePinModalSubmitBtn = document.getElementById('teacherCodePinModalSubmitBtn');
    const teacherCodePinModalCancelBtn = document.getElementById('teacherCodePinModalCancelBtn'); 
    const resetTeacherCodeLink = document.getElementById('resetTeacherCodeLink'); // Giữ lại vì nó không liên quan trực tiếp đến localStorage

    let SECRET_TEACHER_CODE = ""; // Sẽ được tải từ Firestore
    const PIN_LENGTH = 6; 

    // Hàm tải mã giáo viên từ Firestore
    async function loadTeacherCode() {
        try {
            const docRef = doc(db, APP_SETTINGS_COLLECTION, TEACHER_CODE_DOC_ID);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                SECRET_TEACHER_CODE = docSnap.data().code;
                console.log("Teacher code loaded from Firestore:", SECRET_TEACHER_CODE);
            } else {
                console.warn("No teacher code found in Firestore at /appSettings/teacherCode. Please set it up in the Firebase Console. Teacher signup might not work as expected.");
                error_message.innerText = "Error: Teacher code not configured. Please contact support.";
                error_message.style.color = 'orange';
            }
        } catch (error) {
            console.error("Error loading teacher code:", error);
            error_message.innerText = "Error loading teacher code. Please try again.";
            error_message.style.color = 'red';
        }
    }

    loadTeacherCode(); // Gọi hàm này khi DOMContentLoaded


    function showTeacherCodePinModal() {
        console.log("showTeacherCodePinModal: Modal is opening.");
        return new Promise((resolve) => {
            pinInputBoxes.forEach(box => box.value = '');
            teacherCodePinModalError.classList.add('hidden'); 
            
            teacherCodePinModalOverlay.classList.add('visible'); 
            
            setTimeout(() => {
                if (pinInputBoxes.length > 0) {
                    pinInputBoxes[0].focus(); 
                }
            }, 50); 
            
            const getPinCode = () => {
                return pinInputBoxes.map(box => box.value).join('');
            };

            const handleSubmit = () => {
                const enteredCode = getPinCode();
                console.log("handleSubmit: Entered code:", enteredCode);
                if (enteredCode === SECRET_TEACHER_CODE) {
                    teacherCodePinModalOverlay.classList.remove('visible');
                    removePinModalListeners();
                    console.log("handleSubmit: PIN correct. Resolving true.");
                    resolve(true);
                } else {
                    teacherCodePinModalError.classList.remove('hidden'); 
                    console.log("handleSubmit: PIN incorrect. Showing error.");
                }
            };

            const handleCancel = () => {
                teacherCodePinModalOverlay.classList.remove('visible');
                removePinModalListeners();
                console.log("handleCancel: Modal cancelled. Resolving false.");
                resolve(false);
            };

            const handlePinInput = (e) => {
                const inputElement = e.target;
                const index = parseInt(inputElement.dataset.pinIndex);

                // Giới hạn chỉ một ký tự
                if (inputElement.value.length > 1) {
                    inputElement.value = inputElement.value.slice(0, 1);
                }
                inputElement.value = inputElement.value.toUpperCase();

                if (inputElement.value && index < PIN_LENGTH - 1) {
                    pinInputBoxes[index + 1].focus();
                }
                teacherCodePinModalError.classList.add('hidden'); 
            };

            const handlePinKeyDown = (e) => {
                const inputElement = e.target;
                const index = parseInt(inputElement.dataset.pinIndex);

                // Xử lý phím Backspace
                if (e.key === 'Backspace' && inputElement.value === '' && index > 0) {
                    pinInputBoxes[index - 1].focus();
                }
            };
            
            const handleKeyPressOnPinInput = (e) => {
                const inputElement = e.target;
                const index = parseInt(inputElement.dataset.pinIndex);
                if (e.key === 'Enter' && index === PIN_LENGTH - 1) {
                    e.preventDefault();
                    handleSubmit();
                }
            };

            const removePinModalListeners = () => {
                teacherCodePinModalSubmitBtn.removeEventListener('click', handleSubmit);
                if (teacherCodePinModalCancelBtn) { 
                    teacherCodePinModalCancelBtn.removeEventListener('click', handleCancel);
                }
                pinInputBoxes.forEach(box => {
                    box.removeEventListener('input', handlePinInput);
                    box.removeEventListener('keydown', handlePinKeyDown);
                    box.removeEventListener('keypress', handleKeyPressOnPinInput);
                });
                if (resetTeacherCodeLink) {
                    resetTeacherCodeLink.removeEventListener('click', handleResetLinkClick);
                }
            };

            // Attach listeners
            teacherCodePinModalSubmitBtn.addEventListener('click', handleSubmit);
            if (teacherCodePinModalCancelBtn) {
                teacherCodePinModalCancelBtn.addEventListener('click', handleCancel);
            }
            pinInputBoxes.forEach(box => {
                box.addEventListener('input', handlePinInput);
                box.addEventListener('keydown', handlePinKeyDown);
                box.addEventListener('keypress', handleKeyPressOnPinInput);
            });

            const handleResetLinkClick = (e) => {
                e.preventDefault();
                alert('Chức năng cài đặt lại mã PIN chưa được triển khai.');
            };
            if (resetTeacherCodeLink) {
                resetTeacherCodeLink.addEventListener('click', handleResetLinkClick);
            }
        });
    }

    // Logic role_select (đảm bảo teacher-code-group luôn ẩn)
    if (role_select) {
        role_select.addEventListener('change', () => {
            const teacherCodeGroup = document.getElementById('teacher-code-group');
            if (teacherCodeGroup) {
                teacherCodeGroup.classList.add('hidden'); 
            }
            error_message.innerText = ''; 
            error_message.style.color = 'red';
        });

        const teacherCodeGroup = document.getElementById('teacher-code-group');
        if (teacherCodeGroup) {
            teacherCodeGroup.classList.add('hidden');
        }
        role_select.dispatchEvent(new Event('change'));
    }

    // Sự kiện submit cho cả login và signup
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        return window.withButtonLock(e.submitter || form.querySelector('button[type="submit"], input[type="submit"]'), async () => {

        error_message.innerText = '';
        error_message.style.color = 'red';
        
        let errors = [];
        // Dòng này đã được loại bỏ: const users = JSON.parse(localStorage.getItem('users') || '[]');

        if (firstname_input) { 
            errors = await handleSignup(); // Không còn truyền `users`
        } else { 
            errors = await handleLogin(); // Đổi thành async và không truyền `users`
        }

        if (errors && errors.length > 0) {
            error_message.innerText = errors.join('. ');
            error_message.style.color = 'red';
        }

        const allInputs = [firstname_input, email_input, password_input, repeat_password_input].filter(input => input != null);

        allInputs.forEach(input => {
            input.addEventListener('input', () => {
                if (input.parentElement && input.parentElement.classList.contains('incorrect')) {
                    input.parentElement.classList.remove('incorrect')
                    error_message.innerText = ''
                    error_message.style.color = 'red';
                }
            });
        });
        });
    });

    // Hàm xử lý signup
    async function handleSignup() { // Không còn tham số `users`
        let errors = getSignupFormErrors(
            firstname_input.value,
            email_input.value,
            password_input.value,
            repeat_password_input.value
        );

        // Logic kiểm tra email đã tồn tại bằng localStorage đã bị loại bỏ ở đây
        // Firebase Auth sẽ tự động xử lý 'auth/email-already-in-use'

        if (errors.length > 0) {
            return errors; 
        }

        let selectedRole = 'student';
        if (role_select) {
            selectedRole = role_select.value;
        }

        if (selectedRole === 'teacher') {
            console.log("handleSignup: Selected role is teacher. Initiating PIN modal.");
            const isTeacherCodeCorrect = await showTeacherCodePinModal();
            if (!isTeacherCodeCorrect) {
                console.log("handleSignup: PIN modal returned false. Aborting signup.");
                errors.push('Registering for a teacher role requires a valid authentication code.');
                return errors;
            }
            console.log("handleSignup: PIN modal returned true. Continuing signup.");
        }

        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email_input.value, password_input.value);
            const user = userCredential.user;
            console.log("User signed up successfully with Firebase Auth:", user);

            // Lưu thông tin người dùng vào Firestore
            const userProfile = {
                firstname: firstname_input.value,
                lastname: '', // Giữ nguyên
                email: email_input.value,
                role: selectedRole,
                classes: [] // Giữ nguyên
            };
            await setDoc(doc(db, USERS_COLLECTION, user.uid), userProfile);
            console.log("User profile saved to Firestore for UID:", user.uid);

            // Dòng này đã được loại bỏ: users.push(newUser);
            // Dòng này đã được loại bỏ: localStorage.setItem('users', JSON.stringify(users));
            
            showSuccess('Registration successful! Redirecting...', 'index.html');
            
            return [];
        } catch (error) {
            console.error("Error during signup:", error);
            let errorMessage = "An unknown error occurred during registration.";

            switch (error.code) {
                case 'auth/email-already-in-use':
                    errorMessage = 'Email is already in use by another account.';
                    if (email_input.parentElement) {
                        email_input.parentElement.classList.add('incorrect');
                    }
                    break;
                case 'auth/invalid-email':
                    errorMessage = 'The email address is not valid.';
                    if (email_input.parentElement) {
                        email_input.parentElement.classList.add('incorrect');
                    }
                    break;
                case 'auth/weak-password':
                    errorMessage = 'Password is too weak. It must be at least 6 characters.'; // Firebase Auth yêu cầu tối thiểu 6 ký tự
                    if (password_input.parentElement) {
                        password_input.parentElement.classList.add('incorrect');
                    }
                    break;
                default:
                    errorMessage = `Registration failed: ${error.message}`;
            }
            errors.push(errorMessage);
            return errors;
        }
    }

    // Hàm xử lý login
    async function handleLogin() { // Đổi thành async, không còn tham số `users`
        let errors = getLoginFormErrors(email_input.value, password_input.value);

        if (errors.length > 0) {
            return errors;
        }

        try {
            const userCredential = await signInWithEmailAndPassword(auth, email_input.value, password_input.value);
            const user = userCredential.user;
            console.log("User logged in successfully with Firebase Auth:", user);

            // Lấy profile từ Firestore sau khi đăng nhập thành công
            const userDoc = await getDoc(doc(db, USERS_COLLECTION, user.uid));
            if (userDoc.exists()) {
                const userData = userDoc.data();
                console.log("User profile data from Firestore:", userData);
                // Giờ bạn có thể dùng `userData` để hiển thị thông tin hoặc điều hướng
                // Không còn lưu vào sessionStorage
            } else {
                console.warn("User profile not found in Firestore for UID:", user.uid);
                // Trường hợp này không nên xảy ra nếu signup đã lưu profile đúng cách,
                // nhưng nếu có, bạn có thể tạo một profile cơ bản ở đây.
                await setDoc(doc(db, USERS_COLLECTION, user.uid), {
                    email: user.email,
                    role: 'student', // Mặc định nếu không có profile
                    firstname: user.displayName || 'Unnamed User',
                    lastname: '',
                    classes: []
                });
                console.log("Basic user profile created for UID:", user.uid);
            }

            // Dòng này đã được loại bỏ: localStorage.setItem('loggedInUser', JSON.stringify(user));

            showSuccess('Login successful! Redirecting...', 'dashboard.html');
            return [];
        } catch (error) {
            console.error("Error during login:", error);
            let errorMessage = "An unknown error occurred during login.";

            switch (error.code) {
                case 'auth/invalid-email':
                case 'auth/user-not-found': // Firebase sử dụng user-not-found hoặc invalid-email cho trường hợp email không tồn tại/sai
                    errorMessage = 'Invalid email or password.';
                    if (email_input.parentElement) {
                        email_input.parentElement.classList.add('incorrect');
                    }
                    break;
                case 'auth/wrong-password':
                case 'auth/invalid-credential':
                    errorMessage = 'Invalid email or password.';
                    if (password_input.parentElement) {
                        password_input.parentElement.classList.add('incorrect');
                    }
                    break;
                case 'auth/too-many-requests':
                    errorMessage = 'Too many failed login attempts. Please try again later.';
                    break;
                default:
                    errorMessage = `Login failed: ${error.message}`;
            }
            errors.push(errorMessage);
            if (email_input.parentElement) {
                email_input.parentElement.classList.add('incorrect');
            }
            if (password_input.parentElement) {
                password_input.parentElement.classList.add('incorrect');
            }
            return errors;
        }
    }

    // Hàm showSuccess (giữ nguyên)
    function showSuccess(message, redirectUrl) {
        error_message.innerText = message;
        error_message.style.color = 'green';
        setTimeout(() => {
            window.location.href = redirectUrl;
        }, 1500);
    }

    // Reset data (đã loại bỏ localStorage.clear())
    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', async (event) => { 
            return window.withButtonLock(event, async () => {
            const resetMessageElement = document.getElementById('reset-message');
            if (resetMessageElement) {
                resetMessageElement.innerText = ''; 
            }
            showSuccess('Reset action requested. (Note: Data in Firebase must be cleared manually if desired). Reloading page...', 'signup.html');
            });
        });
    }

    // Kiểm tra lỗi cho signup
    function getSignupFormErrors(firstname, email, password, repeatPassword) {
        let errors = []

        if (firstname === '' || firstname == null) {
            errors.push('Username is required');
            if (firstname_input && firstname_input.parentElement)
                firstname_input.parentElement.classList.add('incorrect');
        }
        if (email === '' || email == null) {
            errors.push('Email is required');
            if (email_input && email_input.parentElement)
                email_input.parentElement.classList.add('incorrect');
        }
        if (password === '' || password == null) {
            errors.push('Password is required');
            if (password_input && password_input.parentElement)
                password_input.parentElement.classList.add('incorrect');
        }
        if (password.length < 6) { // Đã sửa từ 8 về 6 để khớp với Firebase Auth mặc định
            errors.push('Password must have at least 6 characters');
            if (password_input && password_input.parentElement)
                password_input.parentElement.classList.add('incorrect');
        }
        if (password !== repeatPassword) {
            errors.push('Password does not match repeated password');
            if (password_input && password_input.parentElement)
                password_input.parentElement.classList.add('incorrect');
            if (repeat_password_input && repeat_password_input.parentElement)
                repeat_password_input.parentElement.classList.add('incorrect');
        }

        return errors;
    }

    // Kiểm tra lỗi cho login
    function getLoginFormErrors(email, password) {
        let errors = []
        if (email === '' || email == null) {
            errors.push('Email is required');
            if (email_input && email_input.parentElement)
                email_input.parentElement.classList.add('incorrect');
        }
        if (password === '' || password == null) {
            errors.push('Password is required');
            if (password_input && password_input.parentElement)
                password_input.parentElement.classList.add('incorrect');
        }
        return errors;
    }
});
