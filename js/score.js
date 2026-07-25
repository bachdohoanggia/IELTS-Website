// score.js
import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
    doc,
    getDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const resultId = urlParams.get('resultId');
    const classCode = urlParams.get('classCode');

    const testNameDisplay = document.getElementById('testNameDisplay');
    const totalQuestionsDisplay = document.getElementById('totalQuestionsDisplay');
    const maxTimeTestDisplay = document.getElementById('maxTimeTestDisplay');

    const correctAnswersValue = document.getElementById('correctAnswersValue');
    const userScoreValue = document.getElementById('userScoreValue');
    const timeSpentValue = document.getElementById('timeSpentValue');
    const maxTimeCircleDisplay = document.getElementById('maxTimeCircleDisplay');
    const submissionTimeDisplay = document.getElementById('submissionTimeDisplay');
    const answerKeysList = document.getElementById('answer-keys-list');
    const deleteScoreBtn = document.getElementById('deleteScoreBtn');

    // Các hàm định dạng thời gian
    function formatSecondsToMinutesSeconds(totalSeconds) {
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    function formatMinutesToMinutesZeroSeconds(totalMinutes) {
        const minutes = parseInt(totalMinutes) || 0;
        return `${minutes.toString().padStart(2, '0')}:00`;
    }

    function displayError(message) {
        testNameDisplay.textContent = message;
        totalQuestionsDisplay.textContent = "N/A";
        maxTimeTestDisplay.textContent = "N/A";
        correctAnswersValue.textContent = "N/A";
        userScoreValue.textContent = "N/A";
        timeSpentValue.textContent = "N/A";
        maxTimeCircleDisplay.textContent = "N/A";
        submissionTimeDisplay.textContent = "N/A";
        console.error(message);
    }

    if (!resultId) {
        displayError("Không tìm thấy ID kết quả trong URL.");
        return;
    }
    
    try {
        const resultRef = doc(db, "testResults", resultId);
        const resultSnap = await getDoc(resultRef);

        if (!resultSnap.exists()) {
            displayError(`Kết quả với ID '${resultId}' không tìm thấy trong Firestore.`);
            return;
        }

        const result = resultSnap.data();
        if (result.deleted) {
            displayError("This score has been deleted.");
            return;
        }

        let testData = null;
        if (result.testId && result.classCode) {
            const testRef = doc(db, "classes", result.classCode, "tests", result.testId);
            const testSnap = await getDoc(testRef);
            if (testSnap.exists()) {
                testData = testSnap.data();
            }
        }
        
        const maxTimeMinutes = testData ? testData.timer : null;
        
        testNameDisplay.textContent = result.testTitle || 'Undefined';
        totalQuestionsDisplay.textContent = result.totalQuestions || '0';

        if (maxTimeMinutes !== undefined && maxTimeMinutes !== null) {
            maxTimeTestDisplay.textContent = (maxTimeMinutes == 0 || maxTimeMinutes == 1) ? 
                `${maxTimeMinutes} minute` : 
                `${maxTimeMinutes} minutes`;
            maxTimeCircleDisplay.textContent = formatMinutesToMinutesZeroSeconds(maxTimeMinutes);
        } else {
            maxTimeTestDisplay.textContent = 'Undefined';
            maxTimeCircleDisplay.textContent = 'N/A';
        }

        if (result.timestamp && submissionTimeDisplay) {
            const submittedDate = result.timestamp.toDate(); // Chuyển đổi Timestamp sang Date
            const formattedTime = submittedDate.toLocaleString('en-US', {
                dateStyle: 'full',
                timeStyle: 'short'
            });
            submissionTimeDisplay.textContent = formattedTime;
        } else if (submissionTimeDisplay) {
            submissionTimeDisplay.textContent = 'N/A';
        }


        function convertScoreToBand(rawScore) {
            if (rawScore >= 39) return 9.0;
            else if (rawScore >= 37) return 8.5;
            else if (rawScore >= 35) return 8.0;
            else if (rawScore >= 33) return 7.5;
            else if (rawScore >= 30) return 7.0;
            else if (rawScore >= 27) return 6.5;
            else if (rawScore >= 23) return 6.0;
            else if (rawScore >= 20) return 5.5;
            else if (rawScore >= 16) return 5.0;
            else if (rawScore >= 13) return 4.5;
            else if (rawScore >= 10) return 4.0;
            else if (rawScore >= 8) return 3.5;
            else if (rawScore >= 6) return 3.0;
            else if (rawScore >= 4) return 2.5;
            else if (rawScore >= 2) return 2.0;
            else if (rawScore >= 1) return 1.5;
            else return 0;
        }


        const correctCount = result.score || 0;
        correctAnswersValue.textContent = `${correctCount}/${result.totalQuestions || '0'}`;
        const bandScore = convertScoreToBand(correctCount);
        userScoreValue.textContent = bandScore.toFixed(1); // hiển thị 1 số thập phân

        const timeSpentSeconds = result.timeSpentSeconds;
        if (timeSpentSeconds !== undefined && timeSpentSeconds !== null) {
            timeSpentValue.textContent = formatSecondsToMinutesSeconds(timeSpentSeconds);
        } else {
            timeSpentValue.textContent = 'N/A';
        }

        // Kiểm tra sự tồn tại của answerKeysList
        if (!answerKeysList) {
            console.error("Không tìm thấy phần tử #answer-keys-list. Vui lòng kiểm tra score.html.");
            return;
        }
        answerKeysList.innerHTML = '';

        function formatQuestionNumberRange(numbers) {
            const cleanNumbers = numbers.map(number => String(number || '').trim()).filter(Boolean);
            const numericNumbers = cleanNumbers.map(Number);
            const isSequential = numericNumbers.length > 1 &&
                numericNumbers.every((number, index) => Number.isInteger(number) && (index === 0 || number === numericNumbers[index - 1] + 1));

            if (isSequential) {
                return `${numericNumbers[0]}-${numericNumbers[numericNumbers.length - 1]}`;
            }
            return cleanNumbers.join(', ');
        }

        function groupSelectionSetAnswers(answers) {
            const groupedAnswers = [];
            const selectionGroups = new Map();

            answers.forEach((answer) => {
                if (answer.type !== 'mcq' || answer.mcqType !== 'selectionSet') {
                    groupedAnswers.push(answer);
                    return;
                }

                const groupKey = JSON.stringify({
                    partNumber: answer.partNumber || '',
                    choices: answer.choices || [],
                    studentAnswer: answer.studentAnswer || []
                });

                if (!selectionGroups.has(groupKey)) {
                    const groupedAnswer = {
                        ...answer,
                        questionNumbers: [],
                        questionTexts: [],
                        correctAnswer: [],
                        correctCount: 0,
                        totalCorrect: 0,
                        isGroupedSelectionSet: true
                    };
                    selectionGroups.set(groupKey, groupedAnswer);
                    groupedAnswers.push(groupedAnswer);
                }

                const groupedAnswer = selectionGroups.get(groupKey);
                groupedAnswer.questionNumbers.push(answer.questionNumber);
                groupedAnswer.questionTexts.push(answer.questionText);
                if (answer.correctAnswer !== null && answer.correctAnswer !== undefined) {
                    groupedAnswer.correctAnswer.push(answer.correctAnswer);
                }
                groupedAnswer.totalCorrect += 1;
                if (answer.isCorrect) groupedAnswer.correctCount += 1;
                groupedAnswer.isCorrect = groupedAnswer.correctCount === groupedAnswer.totalCorrect;
                groupedAnswer.questionNumber = formatQuestionNumberRange(groupedAnswer.questionNumbers);
                groupedAnswer.questionText = `Questions ${groupedAnswer.questionNumber}`;
            });

            return groupedAnswers;
        }

        function renderQuestionNumberBadge(q, questionNumber) {
            if (!q.isGroupedSelectionSet) {
                return `<span class="question-number">${questionNumber}</span>`;
            }

            const numbers = Array.isArray(q.questionNumbers)
                ? q.questionNumbers.map(number => String(number || '').trim()).filter(Boolean)
                : String(questionNumber).split('-').map(number => number.trim()).filter(Boolean);
            const start = numbers[0] || questionNumber;
            const end = numbers[numbers.length - 1] || start;
            return `
                <span class="question-number question-number-range">
                    <span>${start}</span>
                    <span class="range-divider"></span>
                    <span>${end}</span>
                </span>
            `;
        }

        function getChoiceLetter(choiceIndex) {
            return String.fromCharCode(65 + Number(choiceIndex));
        }

        function formatAnswerValue(q, value) {
            if (value === null || value === undefined || value === '') return '';
            if (Array.isArray(value)) {
                return value.map(item => q.type === 'mcq' ? getChoiceLetter(item) : item).join(',');
            }
            return q.type === 'mcq' ? getChoiceLetter(value) : String(value);
        }

        function hasStudentAnswer(q) {
            return q.studentAnswer !== null &&
                q.studentAnswer !== undefined &&
                !(Array.isArray(q.studentAnswer) && q.studentAnswer.length === 0) &&
                String(q.studentAnswer).trim() !== '';
        }

        function getQuestionNumbers(q, fallbackNumber) {
            if (Array.isArray(q.questionNumbers) && q.questionNumbers.length > 0) {
                return q.questionNumbers.map(number => String(number || '').trim()).filter(Boolean);
            }
            return String(fallbackNumber).split('-').map(number => number.trim()).filter(Boolean);
        }

        function getAnswerPointCount(answer) {
            return answer.isGroupedSelectionSet ? answer.totalCorrect || 0 : 1;
        }

        function getPartRangeLabel(startNumber, questionCount) {
            if (!questionCount) return 'Questions';
            const endNumber = startNumber + questionCount - 1;
            return startNumber === endNumber ? `Question ${startNumber}` : `Question ${startNumber} - ${endNumber}`;
        }

        function renderCompactAnswerRow(q, index) {
            const questionNumber = q.questionNumber || index + 1;
            const correctAnswerDisplay = formatAnswerValue(q, q.correctAnswer) || 'N/A';
            const studentAnswerDisplay = hasStudentAnswer(q) ? formatAnswerValue(q, q.studentAnswer) : '';
            const statusIcon = q.isCorrect ? '✓' : '×';
            const statusClass = q.isCorrect ? 'correct-answer-text' : 'incorrect-answer-text';
            const selectionSetProgress = q.isGroupedSelectionSet
                ? ` <span class="selection-set-progress">(Correct ${q.correctCount}/${q.totalCorrect})</span>`
                : '';

            return `
                <div class="compact-answer-row ${q.isCorrect ? 'correct' : 'incorrect'}">
                    ${renderQuestionNumberBadge(q, questionNumber)}
                    <div class="compact-answer-content">
                        <span class="compact-correct-answer correct-answer-text">${correctAnswerDisplay}</span>
                        <span class="compact-separator">:</span>
                        ${studentAnswerDisplay ? `<span class="compact-student-answer">${studentAnswerDisplay}</span>` : ''}
                        ${selectionSetProgress}
                        <span class="compact-status ${statusClass}">${statusIcon}</span>
                    </div>
                </div>
            `;
        }

        const studentAnswers = groupSelectionSetAnswers(result.studentAnswers || []);
        answerKeysList.classList.add('compact-answer-keys');
        const answersByPart = new Map();
        studentAnswers.forEach((answer) => {
            const partNumber = Number(answer.partNumber) || 1;
            if (!answersByPart.has(partNumber)) answersByPart.set(partNumber, []);
            answersByPart.get(partNumber).push(answer);
        });

        let nextPartQuestionStart = 1;
        [...answersByPart.entries()]
            .sort(([partA], [partB]) => partA - partB)
            .forEach(([partNumber, partAnswers]) => {
                const partQuestionCount = partAnswers.reduce((total, answer) => total + getAnswerPointCount(answer), 0);
                const partRangeLabel = getPartRangeLabel(nextPartQuestionStart, partQuestionCount);
                const partSection = document.createElement('section');
                partSection.className = 'answer-part-section';
                partSection.innerHTML = `
                    <h3>Part ${partNumber}: ${partRangeLabel}</h3>
                    <div class="compact-answer-grid">
                        ${partAnswers.map(renderCompactAnswerRow).join('')}
                    </div>
                `;
                answerKeysList.appendChild(partSection);
                nextPartQuestionStart += partQuestionCount;
        });

        setupTeacherDeleteButton(resultId, result.classCode || classCode);

    } catch (e) {
        displayError("N/A");
        console.error("Lỗi Firestore:", e);
    }

    const backToGradesBtn = document.getElementById('backToGradesBtn');
    if (backToGradesBtn) {
        backToGradesBtn.addEventListener('click', () => {
            if (classCode) {
                window.location.href = `class.html?classCode=${classCode}&tab=grades`;
            } else {
                window.location.href = 'class.html';
            }
        });
    }
});

function setupTeacherDeleteButton(resultId, classCode) {
    const deleteScoreBtn = document.getElementById('deleteScoreBtn');
    if (!deleteScoreBtn || !resultId || !classCode) return;

    onAuthStateChanged(auth, async (user) => {
        if (!user) return;

        try {
            const classSnap = await getDoc(doc(db, "classes", classCode));
            if (!classSnap.exists()) return;

            const classData = classSnap.data();
            const isTeacher = Array.isArray(classData.members) &&
                classData.members.some(member => member.id === user.uid && member.role === 'teacher');

            if (!isTeacher) return;

            deleteScoreBtn.classList.remove('hidden');
            deleteScoreBtn.addEventListener('click', async (event) => {
                return window.withButtonLock(event, async () => {
                    if (!await window.appConfirm("Delete this score?", { title: 'Delete score' })) return;
                    try {
                        await updateDoc(doc(db, "testResults", resultId), {
                            deleted: true,
                            deletedAt: new Date(),
                            deletedBy: user.uid
                        });
                        window.location.href = `class.html?classCode=${classCode}&tab=grades`;
                    } catch (error) {
                        console.error("Error deleting score:", error);
                        alert("Failed to delete score: " + error.message);
                    }
                });
            }, { once: true });
        } catch (error) {
            console.error("Error checking score delete permission:", error);
        }
    });
}
