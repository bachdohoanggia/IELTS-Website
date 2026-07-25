import { auth, db } from "./firebase.js";
import {
    doc,
    getDoc,
    addDoc,
    collection
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

let testTimerInterval = null;
let testStartTime = null;
let isSubmittingTest = false;

let lastTooltipX = 0;
let lastTooltipY = 0;

async function submitTest() {
    if (isSubmittingTest) return;
    isSubmittingTest = true;
    if (testTimerInterval) {
        clearInterval(testTimerInterval);
    }

    const urlParams = new URLSearchParams(window.location.search);
    const testId = urlParams.get('testId');
    const classCode = urlParams.get('classCode');
    const userId = auth.currentUser?.uid;

    if (!testId || !classCode || !userId) {
        console.error("Error: Missing test ID, class code, or user ID.");
        alert("Error: Unable to submit test.");
        return;
    }

    try {
        const testDocRef = doc(db, "classes", classCode, "tests", testId);
        const testDocSnap = await getDoc(testDocRef);

        if (!testDocSnap.exists()) {
            console.error("Error: This test could not be found.");
            alert("Error: This test could not be found.");
            return;
        }

        const test = testDocSnap.data();
        const partSubmission = typeof window.getIeltsExamSubmissionData === 'function'
            ? window.getIeltsExamSubmissionData()
            : null;
        const submissionParts = Array.isArray(partSubmission?.parts) ? partSubmission.parts : null;

        if (submissionParts) {
            let score = 0;
            const studentAnswers = [];
            const answers = partSubmission.answers || {};
            const answerKey = typeof window.getAnswerKey === 'function'
                ? window.getAnswerKey
                : (partIndex, questionIndex, itemKey) => `part-${partIndex}-q-${questionIndex}-${itemKey}`;

            submissionParts.forEach((part, partIndex) => {
                const partNumber = part.partNumber || partIndex + 1;
                (part.questions || []).forEach((q, qIndex) => {
                    if (q.type === 'multipleChoiceSection') {
                        if (q.sectionMode === 'selectionSet') {
                            const key = answerKey(partIndex, qIndex, 'selection-set');
                            const selectedAnswers = Array.isArray(answers[key]) ? [...answers[key]].sort((a, b) => a - b) : [];
                            const correctAnswers = Array.isArray(q.correctAnswers) ? [...q.correctAnswers].sort((a, b) => a - b) : [];
                            const hasTooManySelections = selectedAnswers.length > correctAnswers.length;
                            const questionNumbers = Array.isArray(q.questionNumbers) && q.questionNumbers.length > 0
                                ? q.questionNumbers
                                : correctAnswers.map((_, answerIndex) => String(answerIndex + 1));

                            correctAnswers.forEach((correctAnswerIndex, answerIndex) => {
                                const isCorrect = !hasTooManySelections && selectedAnswers.includes(correctAnswerIndex);
                                if (isCorrect) score++;
                                studentAnswers.push({
                                    partNumber,
                                    questionNumber: questionNumbers[answerIndex] || String(answerIndex + 1),
                                    questionText: q.options?.[correctAnswerIndex] || q.title || `Question ${questionNumbers[answerIndex] || answerIndex + 1}`,
                                    type: 'mcq',
                                    mcqType: 'selectionSet',
                                    choices: q.options || [],
                                    correctAnswer: correctAnswerIndex,
                                    studentAnswer: selectedAnswers,
                                    isCorrect
                                });
                            });
                            return;
                        }

                        (q.items || []).forEach((item, itemIndex) => {
                            const key = answerKey(partIndex, qIndex, `item-${itemIndex}`);
                            const correctAnswers = Array.isArray(item.correctAnswers) ? [...item.correctAnswers].sort((a, b) => a - b) : [];
                            const savedAnswer = answers[key];
                            const selectedAnswers = item.mcqType === 'multiple'
                                ? (Array.isArray(savedAnswer) ? [...savedAnswer].sort((a, b) => a - b) : [])
                                : (Number.isInteger(savedAnswer) ? [savedAnswer] : []);
                            const isCorrect = selectedAnswers.length === correctAnswers.length &&
                                selectedAnswers.every((value, index) => value === correctAnswers[index]);
                            if (isCorrect) score++;
                            studentAnswers.push({
                                partNumber,
                                questionNumber: item.number,
                                questionText: item.prompt || q.title || `Question ${item.number}`,
                                type: 'mcq',
                                mcqType: item.mcqType,
                                choices: item.choices,
                                correctAnswer: correctAnswers,
                                studentAnswer: selectedAnswers,
                                isCorrect
                            });
                        });
                    } else if (q.type === 'inlineBlankSection') {
                        (q.blanks || []).forEach((blank) => {
                            const key = answerKey(partIndex, qIndex, `blank-${blank.number}`);
                            const val = String(answers[key] || '').trim();
                            const isCorrect = val.toLowerCase() === String(blank.answer || '').trim().toLowerCase();
                            if (isCorrect) score++;
                            studentAnswers.push({
                                partNumber,
                                questionNumber: blank.number,
                                questionText: q.title || `Question ${blank.number}`,
                                type: 'inlineBlank',
                                correctAnswer: blank.answer,
                                studentAnswer: val,
                                isCorrect
                            });
                        });
                    } else if (q.type === 'dropdownSection') {
                        (q.rows || []).forEach((row) => {
                            const key = answerKey(partIndex, qIndex, `dropdown-${row.number || ''}`);
                            const val = String(answers[key] || '').trim();
                            const isCorrect = val.toLowerCase() === String(row.answer || '').trim().toLowerCase();
                            if (isCorrect) score++;
                            studentAnswers.push({
                                partNumber,
                                questionNumber: row.number,
                                questionText: row.prompt || q.title || `Question ${row.number}`,
                                type: 'dropdownChoice',
                                choices: q.options || [],
                                correctAnswer: row.answer,
                                studentAnswer: val,
                                isCorrect
                            });
                        });
                    } else if (q.type === 'mcq') {
                        const key = answerKey(partIndex, qIndex, 'legacy');
                        const correctAnswers = Array.isArray(q.correctAnswers) ? [...q.correctAnswers].sort((a, b) => a - b) : [];
                        const savedAnswer = answers[key];
                        const selectedAnswers = q.mcqType === 'multiple'
                            ? (Array.isArray(savedAnswer) ? [...savedAnswer].sort((a, b) => a - b) : [])
                            : (Number.isInteger(savedAnswer) ? [savedAnswer] : []);
                        const isCorrect = selectedAnswers.length === correctAnswers.length &&
                            selectedAnswers.every((value, index) => value === correctAnswers[index]);
                        if (isCorrect) score++;
                        studentAnswers.push({
                            partNumber,
                            questionText: q.qText,
                            type: 'mcq',
                            mcqType: q.mcqType,
                            choices: q.choices,
                            correctAnswer: correctAnswers,
                            studentAnswer: selectedAnswers,
                            isCorrect
                        });
                    } else if (q.type === 'text') {
                        const key = answerKey(partIndex, qIndex, 'legacy');
                        const val = String(answers[key] || '').trim();
                        const isCorrect = val.toLowerCase() === String(q.answer || '').trim().toLowerCase();
                        if (isCorrect) score++;
                        studentAnswers.push({
                            partNumber,
                            questionText: q.qText,
                            type: 'text',
                            correctAnswer: q.answer,
                            studentAnswer: val,
                            isCorrect
                        });
                    }
                });
            });

            let timeSpentSeconds = 0;
            if (testStartTime) {
                timeSpentSeconds = Math.floor((Date.now() - testStartTime) / 1000);
            }
            const maxTimeMinutes = test.timer || 0;
            const totalQuestions = submissionParts.reduce((total, part) => (
                total + (part.questions || []).reduce((partTotal, question) => {
                    if (question.type === 'multipleChoiceSection') {
                        if (question.sectionMode === 'selectionSet') {
                            return partTotal + (Array.isArray(question.correctAnswers) ? question.correctAnswers.length : 0);
                        }
                        return partTotal + (Array.isArray(question.items) ? question.items.length : 0);
                    }
                    if (question.type === 'inlineBlankSection') {
                        return partTotal + (Array.isArray(question.blanks) ? question.blanks.length : 0);
                    }
                    if (question.type === 'dropdownSection') {
                        return partTotal + (Array.isArray(question.rows) ? question.rows.length : 0);
                    }
                    return partTotal + 1;
                }, 0)
            ), 0);

            const resultDocRef = await addDoc(collection(db, "testResults"), {
                userId: userId,
                testId: testId,
                testTitle: test.title,
                score: score,
                totalQuestions,
                timestamp: new Date(),
                classCode: classCode,
                studentAnswers: studentAnswers,
                maxTimeMinutes: maxTimeMinutes,
                timeSpentSeconds: timeSpentSeconds
            });

            console.log("Test result saved successfully with ID:", resultDocRef.id);
            window.location.href = `score.html?resultId=${resultDocRef.id}&classCode=${classCode}`;
            return;
        }
        const qEls = document.querySelectorAll('.question');
        let score = 0;
        const studentAnswers = [];

        qEls.forEach((el, i) => {
            const q = test.questions[i];
            let isCorrect = false;
            let studentAnswer = null;

            if (q.type === 'multipleChoiceSection') {
                const items = Array.isArray(q.items) ? q.items : [];
                let allItemsCorrect = true;

                items.forEach((item, itemIndex) => {
                    const itemElement = el.querySelector(`.mcq-section-item[data-item-index="${itemIndex}"]`);
                    const selectedInputs = itemElement ? [...itemElement.querySelectorAll('.mcq-answer-input:checked')] : [];
                    const selectedAnswers = selectedInputs.map(input => +input.value).sort((a, b) => a - b);
                    const correctAnswers = Array.isArray(item.correctAnswers) ? [...item.correctAnswers].sort((a, b) => a - b) : [];
                    const itemCorrect = selectedAnswers.length === correctAnswers.length &&
                        selectedAnswers.every((value, index) => value === correctAnswers[index]);

                    if (itemElement) {
                        itemElement.classList.add(itemCorrect ? 'correct' : 'incorrect');
                    }
                    if (itemCorrect) {
                        score++;
                    } else {
                        allItemsCorrect = false;
                    }

                    studentAnswers.push({
                        questionNumber: item.number,
                        questionText: item.prompt || q.title || `Question ${item.number}`,
                        type: 'mcq',
                        mcqType: item.mcqType,
                        choices: item.choices,
                        correctAnswer: correctAnswers,
                        studentAnswer: selectedAnswers,
                        isCorrect: itemCorrect
                    });
                });

                el.classList.add(allItemsCorrect ? 'correct' : 'incorrect');
            } else if (q.type === 'inlineBlankSection') {
                const blanks = Array.isArray(q.blanks) ? q.blanks : [];
                let allBlanksCorrect = true;

                blanks.forEach((blank) => {
                    const input = el.querySelector(`.inline-blank-answer[data-blank-number="${blank.number}"]`);
                    const val = input ? input.value.trim() : '';
                    const blankCorrect = val.toLowerCase() === String(blank.answer || '').trim().toLowerCase();

                    if (input) {
                        input.classList.add(blankCorrect ? 'correct' : 'incorrect');
                    }
                    if (blankCorrect) {
                        score++;
                    } else {
                        allBlanksCorrect = false;
                    }

                    studentAnswers.push({
                        questionNumber: blank.number,
                        questionText: q.title || `Question ${blank.number}`,
                        type: 'inlineBlank',
                        correctAnswer: blank.answer,
                        studentAnswer: val,
                        isCorrect: blankCorrect
                    });
                });

                el.classList.add(allBlanksCorrect ? 'correct' : 'incorrect');
            } else if (q.type === 'dropdownSection') {
                const rows = Array.isArray(q.rows) ? q.rows : [];
                let allDropdownsCorrect = true;

                rows.forEach((row) => {
                    const select = el.querySelector(`.dropdown-answer-select[data-question-number="${row.number}"]`);
                    const val = select ? select.value.trim() : '';
                    const dropdownCorrect = val.toLowerCase() === String(row.answer || '').trim().toLowerCase();

                    if (select) {
                        select.classList.add(dropdownCorrect ? 'correct' : 'incorrect');
                    }
                    if (dropdownCorrect) {
                        score++;
                    } else {
                        allDropdownsCorrect = false;
                    }

                    studentAnswers.push({
                        questionNumber: row.number,
                        questionText: row.prompt || q.title || `Question ${row.number}`,
                        type: 'dropdownChoice',
                        choices: q.options || [],
                        correctAnswer: row.answer,
                        studentAnswer: val,
                        isCorrect: dropdownCorrect
                    });
                });

                el.classList.add(allDropdownsCorrect ? 'correct' : 'incorrect');
            } else if (q.type === 'mcq') {
                if (q.mcqType === 'single') {
                    const selectedRadio = el.querySelector('input[type=radio]:checked');
                    if (selectedRadio) {
                        studentAnswer = +selectedRadio.value;
                        if (studentAnswer === q.correctAnswers[0]) {
                            el.classList.add('correct');
                            isCorrect = true;
                            score++;
                        } else {
                            el.classList.add('incorrect');
                        }
                    } else {
                        el.classList.add('incorrect');
                    }
                    studentAnswers.push({
                        questionText: q.qText,
                        type: 'mcq',
                        mcqType: q.mcqType,
                        choices: q.choices,
                        correctAnswer: q.correctAnswers,
                        studentAnswer: studentAnswer,
                        isCorrect: isCorrect
                    });
                } else if (q.mcqType === 'multiple') {
                    const selectedCheckboxes = el.querySelectorAll('input[type=checkbox]:checked');
                    const selectedAnswers = Array.from(selectedCheckboxes).map(cb => +cb.value).sort((a, b) => a - b);
                    studentAnswer = selectedAnswers;

                    if (q.correctAnswers && Array.isArray(q.correctAnswers) &&
                        selectedAnswers.length === q.correctAnswers.length &&
                        selectedAnswers.every((val, idx) => val === q.correctAnswers[idx])) {
                        el.classList.add('correct');
                        isCorrect = true;
                        score++;
                    } else {
                        el.classList.add('incorrect');
                    }

                    studentAnswers.push({
                        questionText: q.qText,
                        type: 'mcq',
                        mcqType: q.mcqType,
                        choices: q.choices,
                        correctAnswer: q.correctAnswers,
                        studentAnswer: studentAnswer,
                        isCorrect: isCorrect
                    });
                }
            } else if (q.type === 'text') {
                const shortAnswerInput = el.querySelector('.short-answer');
                if (shortAnswerInput) {
                    const val = shortAnswerInput.value.trim();
                    studentAnswer = val;
                    if (val.toLowerCase() === q.answer.trim().toLowerCase()) {
                        el.classList.add('correct');
                        isCorrect = true;
                        score++;
                    } else {
                        el.classList.add('incorrect');
                    }
                } else {
                    el.classList.add('incorrect');
                }
                studentAnswers.push({
                    questionText: q.qText,
                    type: 'text',
                    correctAnswer: q.answer,
                    studentAnswer: studentAnswer,
                    isCorrect: isCorrect
                });
            }
        });

        let timeSpentSeconds = 0;
        if (testStartTime) {
            timeSpentSeconds = Math.floor((Date.now() - testStartTime) / 1000);
        }
        const maxTimeMinutes = test.timer || 0;
        const totalQuestions = (test.questions || []).reduce((total, question) => {
            if (question.type === 'multipleChoiceSection') {
                return total + (Array.isArray(question.items) ? question.items.length : 0);
            }
            if (question.type === 'inlineBlankSection') {
                return total + (Array.isArray(question.blanks) ? question.blanks.length : 0);
            }
            if (question.type === 'dropdownSection') {
                return total + (Array.isArray(question.rows) ? question.rows.length : 0);
            }
            return total + 1;
        }, 0);

        // LƯU KẾT QUẢ VÀO FIRESTORE THAY VÌ localStorage
        const resultDocRef = await addDoc(collection(db, "testResults"), {
            userId: userId,
            testId: testId,
            testTitle: test.title,
            score: score,
            totalQuestions,
            timestamp: new Date(),
            classCode: classCode,
            studentAnswers: studentAnswers,
            maxTimeMinutes: maxTimeMinutes,
            timeSpentSeconds: timeSpentSeconds
        });

        console.log("Test result saved successfully with ID:", resultDocRef.id);
        window.location.href = `score.html?resultId=${resultDocRef.id}&classCode=${classCode}`;

    } catch (e) {
        console.error("Error submitting test:", e);
        alert("Error submitting test. Please try again.");
    } finally {
        isSubmittingTest = false;
    }
}

function startCountdown(durationInSeconds) {
    const countdownEl = document.getElementById('countdown');
    if (!countdownEl) return;

    if (testTimerInterval) {
        clearInterval(testTimerInterval);
    }

    testStartTime = Date.now();
    let targetEndTime = testStartTime + durationInSeconds * 1000;

    const updateCountdown = () => {
        const now = Date.now();
        let remainingSeconds = Math.round((targetEndTime - now) / 1000);

        if (remainingSeconds < 0) {
            remainingSeconds = 0;
        }
        
        const min = Math.floor(remainingSeconds / 60);
        const sec = remainingSeconds % 60;
        countdownEl.textContent = `${min}:${sec < 10 ? '0' : ''}${sec}`;

        if (remainingSeconds <= 0) {
            clearInterval(testTimerInterval);
            submitTest();
        }
    };

    updateCountdown();

    testTimerInterval = setInterval(updateCountdown, 1000);
}


document.addEventListener('DOMContentLoaded', () => {
    const tooltip = document.getElementById('selection-tooltip');
    const highlightBtn = document.getElementById('tooltip-highlight-btn');
    const noteBtn = document.getElementById('tooltip-note-btn');
    const removeHighlightBtn = document.getElementById('tooltip-remove-highlight-btn');
    const removeNoteBtn = document.getElementById('tooltip-remove-note-btn');

    if (!tooltip || !highlightBtn || !noteBtn || !removeHighlightBtn || !removeNoteBtn) {
        console.error("Highlight tooltip or its buttons not found in HTML. Check your exam.html file or ensure highlight.js loads after them.");
        return;
    }

    let currentSelectionRange = null;
    let highlightedElements = [];
    let isMouseDragging = false;

    function getTextNodesInRange(range) {
        const commonAncestor = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
            ? range.commonAncestorContainer.parentNode
            : range.commonAncestorContainer;
        const root = commonAncestor.closest?.('#exam-instructions, #exam-questions') || commonAncestor;
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    if (!node.nodeValue || !node.nodeValue.trim()) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return range.intersectsNode(node)
                        ? NodeFilter.FILTER_ACCEPT
                        : NodeFilter.FILTER_REJECT;
                }
            }
        );
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) {
            nodes.push(node);
        }
        return nodes;
    }

    function wrapRangeText(range, className, attributes = {}) {
        if (!range || range.collapsed) return [];
        const textNodes = getTextNodesInRange(range);
        const wrappers = [];
        const originalStartContainer = range.startContainer;
        const originalStartOffset = range.startOffset;
        const originalEndContainer = range.endContainer;
        const originalEndOffset = range.endOffset;
        const segments = textNodes.map(textNode => {
            let start = 0;
            let end = textNode.nodeValue.length;

            if (textNode === originalStartContainer) {
                start = originalStartOffset;
            }
            if (textNode === originalEndContainer) {
                end = originalEndOffset;
            }
            return { textNode, start, end };
        }).filter(segment => segment.start < segment.end);

        segments.reverse().forEach(({ textNode, start, end }) => {
            if (!textNode.parentNode) return;
            let selectedNode = textNode;

            if (end < selectedNode.nodeValue.length) {
                selectedNode.splitText(end);
            }
            if (start > 0) {
                selectedNode = selectedNode.splitText(start);
            }
            if (!selectedNode.nodeValue) return;

            const span = document.createElement('span');
            span.className = className;
            if (className === 'highlighted-text') {
                span.style.backgroundColor = '#fff176';
            }
            if (className === 'noted-text') {
                span.style.color = '#dc2626';
                span.style.backgroundColor = 'rgba(220, 38, 38, 0.12)';
            }
            Object.entries(attributes).forEach(([key, value]) => {
                span.setAttribute(key, value);
            });

            selectedNode.parentNode.insertBefore(span, selectedNode);
            span.appendChild(selectedNode);
            wrappers.push(span);
        });

        return wrappers;
    }

    function getRangeForToolbarAction() {
        const selection = window.getSelection();
        const leftPanel = document.getElementById('exam-instructions');
        if (selection.rangeCount > 0 && selection.toString().trim()) {
            const range = selection.getRangeAt(0).cloneRange();
            if (!leftPanel || leftPanel.contains(range.commonAncestorContainer) || leftPanel.contains(range.startContainer) || leftPanel.contains(range.endContainer)) {
                currentSelectionRange = range.cloneRange();
                return range;
            }
        }
        return currentSelectionRange ? currentSelectionRange.cloneRange() : null;
    }

    function unwrapElement(element) {
        const parent = element?.parentNode;
        if (!parent) return;
        while (element.firstChild) {
            parent.insertBefore(element.firstChild, element);
        }
        parent.removeChild(element);
        parent.normalize();
    }

    function closestFromNode(node, selector) {
        if (!node) return null;
        const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        return element?.closest ? element.closest(selector) : null;
    }

    function isSelectionWithinNotedHighlight(selectionRange) {
        if (!selectionRange || selectionRange.collapsed) return null;

        let commonAncestor = selectionRange.commonAncestorContainer;
        if (commonAncestor.nodeType === Node.TEXT_NODE) {
            commonAncestor = commonAncestor.parentNode;
        }

        const notedSpan = closestFromNode(commonAncestor, '.noted-text');

        if (notedSpan && notedSpan.hasAttribute('data-note-id')) {
            const highlightRange = document.createRange();
            highlightRange.selectNodeContents(notedSpan);

            if (selectionRange.compareBoundaryPoints(Range.END_TO_START, highlightRange) < 0 &&
                selectionRange.compareBoundaryPoints(Range.START_TO_END, highlightRange) > 0) {
                return notedSpan;
            }
        }
        return null;
    }

    function showTooltip(x, y, isAStandardHighlight = false, isANotedHighlight = false) {
        tooltip.style.left = `${x}px`;
        tooltip.style.top = `${y}px`;
        tooltip.classList.remove('hidden');
        tooltip.style.visibility = 'visible';

        lastTooltipX = x;
        lastTooltipY = y;

        highlightBtn.classList.add('hidden');
        noteBtn.classList.add('hidden');
        removeHighlightBtn.classList.add('hidden');
        removeNoteBtn.classList.add('hidden');

        if (isANotedHighlight) {
            highlightBtn.classList.remove('hidden');
            removeNoteBtn.classList.remove('hidden');
        } else if (isAStandardHighlight) {
            noteBtn.classList.remove('hidden');
            removeHighlightBtn.classList.remove('hidden');
        } else {
            highlightBtn.classList.remove('hidden');
            noteBtn.classList.remove('hidden');
        }
    }

    function hideTooltip() {
        tooltip.classList.add('hidden');
        tooltip.style.visibility = '';
    }

    function updateTooltipPositionAndVisibility() {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        const leftPanel = document.getElementById('exam-instructions');

        if (selectedText.length === 0 || !leftPanel || (!leftPanel.contains(selection.anchorNode) && !leftPanel.contains(selection.focusNode))) {
            hideTooltip();
            return;
        }

        currentSelectionRange = selection.getRangeAt(0).cloneRange();

        const rect = currentSelectionRange.getBoundingClientRect();
        const panelRect = leftPanel.getBoundingClientRect();

        const originalStyle = tooltip.style.cssText;
        tooltip.style.cssText = `
            position: absolute;
            left: -9999px;
            top: -9999px;
            visibility: hidden;
            display: flex;
        `;
        tooltip.classList.remove('hidden');
        const tooltipHeight = tooltip.offsetHeight;
        const tooltipWidth = tooltip.offsetWidth;
        tooltip.style.cssText = originalStyle;
        tooltip.classList.add('hidden');

        let tooltipX = rect.left + (rect.width / 2) - (tooltipWidth / 2);
        let tooltipY = rect.top - tooltipHeight - 10;

        if (tooltipX < panelRect.left) {
            tooltipX = panelRect.left;
        } else if (tooltipX + tooltipWidth > panelRect.right) {
            tooltipX = panelRect.right - tooltipWidth;
        }

        if (tooltipY < panelRect.top) {
            tooltipY = rect.bottom + 10;
        }

        const selectedNotedHighlight = isSelectionWithinNotedHighlight(currentSelectionRange);

        const isAStandardHighlight = highlightedElements.some(el => {
            const highlightRange = document.createRange();
            highlightRange.selectNodeContents(el);
            return (currentSelectionRange.compareBoundaryPoints(Range.START_TO_START, highlightRange) >= 0 &&
                    currentSelectionRange.compareBoundaryPoints(Range.END_TO_END, highlightRange) <= 0);
        });

        showTooltip(tooltipX, tooltipY, isAStandardHighlight, !!selectedNotedHighlight);
    }

    document.addEventListener('mousedown', (event) => {
        const leftPanel = document.getElementById('exam-instructions');
        if (leftPanel && leftPanel.contains(event.target)) {
            isMouseDragging = true;
        } else {
            isMouseDragging = false;
        }
        if (!tooltip.contains(event.target)) {
            hideTooltip();
        }
    });

    document.addEventListener('mouseup', (event) => {
        if (isMouseDragging) {
            isMouseDragging = false;
            setTimeout(() => {
                updateTooltipPositionAndVisibility();
            }, 10);
        } else {
            const isClickInsideTooltip = tooltip.contains(event.target);
            const notepadSidebarElement = document.getElementById('notepad-sidebar');
            const isClickInsideNotepad = notepadSidebarElement && notepadSidebarElement.contains(event.target);
            const noteInputModalElement = document.getElementById('note-input-modal');
            const isClickInsideNoteModal = noteInputModalElement && noteInputModalElement.contains(event.target);

            if (!isClickInsideTooltip && !isClickInsideNotepad && !isClickInsideNoteModal) {
                hideTooltip();
            }
        }
    });

    document.addEventListener('contextmenu', (event) => {
        const selection = window.getSelection();
        const leftPanel = document.getElementById('exam-instructions');

        if (selection.toString().trim().length > 0 && leftPanel && (leftPanel.contains(selection.anchorNode) || leftPanel.contains(selection.focusNode))) {
            event.preventDefault();
            updateTooltipPositionAndVisibility();
        } else {
            hideTooltip();
        }
    });

    document.addEventListener('selectionchange', () => {
        setTimeout(() => {
            const selection = window.getSelection();
            const leftPanel = document.getElementById('exam-instructions');
            if (selection.toString().trim().length === 0 ||
                (!leftPanel.contains(selection.anchorNode) && !leftPanel.contains(selection.focusNode))) {
                if (!tooltip.contains(document.activeElement) && !highlightBtn.contains(document.activeElement)) {
                    hideTooltip();
                }
            }
        }, 100);
    });

    document.addEventListener('click', (event) => {
        if (event.button !== 0) {
            hideTooltip();
            return;
        }

        const clickedElement = event.target;
        const clickedHighlightedSpan = clickedElement.closest('.highlighted-text, .noted-text');

        if (clickedHighlightedSpan) {
            const range = document.createRange();
            range.selectNodeContents(clickedHighlightedSpan);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            currentSelectionRange = range;

            const rect = clickedHighlightedSpan.getBoundingClientRect();

            const originalStyle = tooltip.style.cssText;
            tooltip.style.cssText = `
                position: absolute;
                left: -9999px;
                top: -9999px;
                visibility: hidden;
                display: flex;
            `;
            tooltip.classList.remove('hidden');
            const tooltipHeight = tooltip.offsetHeight;
            const tooltipWidth = tooltip.offsetWidth;
            tooltip.style.cssText = originalStyle;
            tooltip.classList.add('hidden');

            let tooltipX = rect.left + (rect.width / 2) - (tooltipWidth / 2);
            let tooltipY = rect.top - tooltipHeight - 10;

            const panelRect = document.getElementById('exam-instructions').getBoundingClientRect();
            if (tooltipY < panelRect.top) {
                tooltipY = rect.bottom + 10;
            }

            const isANotedHighlight = clickedHighlightedSpan.classList.contains('noted-text') && clickedHighlightedSpan.hasAttribute('data-note-id');
            const isAStandardHighlight = clickedHighlightedSpan.classList.contains('highlighted-text') && !isANotedHighlight;

            showTooltip(tooltipX, tooltipY, isAStandardHighlight, isANotedHighlight);
        } else if (!tooltip.contains(event.target)) {
            const notepadSidebarElement = document.getElementById('notepad-sidebar');
            const isClickInsideNotepad = notepadSidebarElement && notepadSidebarElement.contains(event.target);
            const noteInputModalElement = document.getElementById('note-input-modal');
            const isClickInsideNoteModal = noteInputModalElement && noteInputModalElement.contains(event.target);

            if (!isClickInsideNotepad && !isClickInsideNoteModal) {
                hideTooltip();
            }
        }
    });

    [highlightBtn, noteBtn, removeHighlightBtn, removeNoteBtn].forEach(button => {
        button.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
    });

    highlightBtn.addEventListener('click', () => {
        const actionRange = getRangeForToolbarAction();
        if (actionRange) {
            try {
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(actionRange);

                if (actionRange.commonAncestorContainer && actionRange.commonAncestorContainer.parentNode) {
                    const highlightId = `highlight-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                    const spans = wrapRangeText(actionRange, 'highlighted-text', {
                        'data-highlight-id': highlightId
                    });
                    highlightedElements.push(...spans);
                    window.getSelection().removeAllRanges();
                    hideTooltip();
                } else {
                    console.warn("currentSelectionRange is no longer valid for extraction. The DOM structure might have changed.");
                    window.getSelection().removeAllRanges();
                    hideTooltip();
                }
            } catch (e) {
                console.error("Error highlighting text:", e);
                window.getSelection().removeAllRanges();
                hideTooltip();
            }
        } else {
            console.warn("No valid selection range to highlight.");
            hideTooltip();
        }
    });

    noteBtn.addEventListener('click', () => {
        const actionRange = getRangeForToolbarAction();
        if (actionRange) {
            currentSelectionRange = actionRange.cloneRange();
            const selectedText = actionRange.toString();
            const rect = actionRange.getBoundingClientRect();
            const noteInputModal = document.getElementById('note-input-modal');

            const originalModalDisplay = noteInputModal.style.display;
            const originalModalVisibility = noteInputModal.style.visibility;
            noteInputModal.style.display = 'block';
            noteInputModal.style.visibility = 'hidden';
            const modalWidth = noteInputModal.offsetWidth;
            const modalHeight = noteInputModal.offsetHeight;
            noteInputModal.style.display = originalModalDisplay;
            noteInputModal.style.visibility = originalModalVisibility;

            let modalY = rect.bottom + window.scrollY + 10;
            let modalX = rect.left + window.scrollX + (rect.width / 2) - (modalWidth / 2);

            const leftPanel = document.getElementById('exam-instructions');
            const panelRect = leftPanel ? leftPanel.getBoundingClientRect() : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };

            if (modalX < panelRect.left + window.scrollX) {
                modalX = panelRect.left + window.scrollX + 10;
            }
            if (modalX + modalWidth > panelRect.right + window.scrollX) {
                modalX = panelRect.right + window.scrollX - modalWidth - 10;
            }

            if (modalY < window.scrollY + 10) {
                modalY = window.scrollY + 10;
            }

            if (modalY + modalHeight > window.innerHeight + window.scrollY - 10) {
                modalY = window.innerHeight + window.scrollY - modalHeight - 10;
            }

            if (typeof window.openNotepadWithSelection === 'function') {
                window.openNotepadWithSelection(selectedText, modalX, modalY, currentSelectionRange);
            } else {
                console.error("Function openNotepadWithSelection is not defined. Make sure notepad.js is loaded.");
                alert(`You selected: "${selectedText}". This is where your note-taking modal would appear.`);
            }
            window.getSelection().removeAllRanges();
            hideTooltip();
        }
    });

    removeHighlightBtn.addEventListener('click', (event) => {
        let targetHighlight = null;
        if (currentSelectionRange) {
            targetHighlight = closestFromNode(currentSelectionRange.commonAncestorContainer, '.highlighted-text');
            if (!targetHighlight && currentSelectionRange.startContainer && currentSelectionRange.startContainer.nodeType === Node.ELEMENT_NODE && currentSelectionRange.startContainer.classList.contains('highlighted-text')) {
                targetHighlight = currentSelectionRange.startContainer;
            }
            if (targetHighlight && targetHighlight.classList.contains('noted-text')) {
                targetHighlight = null;
            }
        }

        if (targetHighlight) {
            const highlightId = targetHighlight.getAttribute('data-highlight-id');
            const targets = highlightId
                ? Array.from(document.querySelectorAll('.highlighted-text')).filter(el => el.getAttribute('data-highlight-id') === highlightId)
                : [targetHighlight];

            targets.forEach(unwrapElement);
            highlightedElements = highlightedElements.filter(el => !targets.includes(el));
            console.log("Standard highlight removed.");
        } else {
            console.warn("Could not find standard highlight to remove for the current selection.");
        }
        window.getSelection().removeAllRanges();
        hideTooltip();
    });

    removeNoteBtn.addEventListener('click', (event) => {
        let targetNotedHighlight = null;
        let noteIdToRemove = null;

        if (currentSelectionRange) {
            targetNotedHighlight = isSelectionWithinNotedHighlight(currentSelectionRange);
        }

        if (targetNotedHighlight) {
            noteIdToRemove = targetNotedHighlight.getAttribute('data-note-id');

            const targets = noteIdToRemove
                ? Array.from(document.querySelectorAll('.noted-text')).filter(el => el.getAttribute('data-note-id') === noteIdToRemove)
                : [targetNotedHighlight];
            targets.forEach(unwrapElement);

            if (noteIdToRemove && typeof window.deleteNote === 'function') {
                window.deleteNote(noteIdToRemove);
                console.log(`Note with ID ${noteIdToRemove} and its highlight removed.`);
            } else {
                console.error(`Attempted to remove noted highlight, but note ID missing or window.deleteNote is not defined.`);
            }

        } else {
            console.warn("Could not find noted highlight to remove for the current selection.");
        }
        window.getSelection().removeAllRanges();
        hideTooltip();
    });

    tooltip.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });
});


document.addEventListener('DOMContentLoaded', () => {
    const fullScreenBtn = document.getElementById('full-screen-btn');

    if (fullScreenBtn) {
        function updateFullScreenButtonUI() {
            const isInFullScreen = document.fullscreenElement ||
                                       document.webkitFullscreenElement ||
                                       document.mozFullScreenElement ||
                                       document.msFullscreenElement;

            if (isInFullScreen) {
                fullScreenBtn.classList.add('is-fullscreen');
                fullScreenBtn.title = 'Exit Full Screen Mode';
            } else {
                fullScreenBtn.classList.remove('is-fullscreen');
                fullScreenBtn.title = 'Full Screen Mode';
            }
        }

        fullScreenBtn.addEventListener('click', () => {
            const isInFullScreen = document.fullscreenElement ||
                                       document.webkitFullscreenElement ||
                                       document.mozFullScreenElement ||
                                       document.msFullscreenElement;

            if (!isInFullScreen) {
                if (document.body.requestFullscreen) {
                    document.body.requestFullscreen();
                } else if (document.body.mozRequestFullScreen) {
                    document.body.mozRequestFullScreen();
                } else if (document.body.webkitRequestFullscreen) {
                    document.body.webkitRequestFullscreen();
                } else if (document.body.msRequestFullscreen) {
                    document.body.msRequestFullscreen();
                }
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                } else if (document.mozCancelFullScreen) {
                    document.mozCancelFullScreen();
                } else if (document.webkitExitFullscreen) {
                    document.webkitExitFullscreen();
                } else if (document.body.msExitFullscreen) {
                    document.body.msExitFullscreen();
                }
            }
        });
        document.addEventListener('fullscreenchange', updateFullScreenButtonUI);
        document.addEventListener('webkitfullscreenchange', updateFullScreenButtonUI);
        document.addEventListener('mozfullscreenchange', updateFullScreenButtonUI);
        document.addEventListener('MSFullscreenChange', updateFullScreenButtonUI);

        updateFullScreenButtonUI();

    } else {
        console.error("Lỗi: Nút Full Screen (ID 'full-screen-btn') không tìm thấy trong HTML.");
    }


    const submitConfirmModal = document.getElementById('submitConfirmModal');
    const submitCancelBtn = document.getElementById('submitCancelBtn');
    const submitReviewBtn = document.getElementById('submitReviewBtn');
    const submitTestButton = document.getElementById('main-submit-button');
    const submitCloseButton = submitConfirmModal ? submitConfirmModal.querySelector('#submitCloseButton') : null;


    if (submitTestButton && submitConfirmModal && submitCancelBtn && submitReviewBtn) {
        submitTestButton.addEventListener('click', (event) => {
            event.preventDefault();
            submitConfirmModal.classList.add('visible');
        });

        submitCancelBtn.addEventListener('click', () => {
            submitConfirmModal.classList.remove('visible');
        });

        submitReviewBtn.addEventListener('click', (event) => {
            window.withButtonLock(event, async () => {
                submitConfirmModal.classList.remove('visible');
                if (testTimerInterval) {
                    clearInterval(testTimerInterval);
                }
                await submitTest();
            });
        });

        if (submitCloseButton) {
            submitCloseButton.addEventListener('click', () => {
                submitConfirmModal.classList.remove('visible');
            });
        }

        submitConfirmModal.addEventListener('click', (event) => {
            if (event.target === submitConfirmModal) {
                submitConfirmModal.classList.remove('visible');
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && submitConfirmModal.classList.contains('visible')) {
                submitConfirmModal.classList.remove('visible');
            }
        });

    } else {
        console.warn("Cảnh báo: Không tìm thấy các phần tử Modal Submit Confirmation.");
    }

    const countdownEl = document.getElementById('countdown');
    if (countdownEl) {
        const urlParams = new URLSearchParams(window.location.search);
        const testId = urlParams.get('testId');
        const classCode = urlParams.get('classCode');

        if (testId && classCode) {
            const testDocRef = doc(db, "classes", classCode, "tests", testId);
            getDoc(testDocRef).then(docSnap => {
                if (docSnap.exists() && docSnap.data().timer) {
                    startCountdown(docSnap.data().timer * 60);
                } else {
                    console.warn("Không tìm thấy thời gian bài kiểm tra hoặc bài kiểm tra hiện tại. Bộ đếm ngược không bắt đầu.");
                }
            }).catch(error => {
                console.error("Lỗi khi tải dữ liệu bài kiểm tra để khởi động bộ đếm ngược:", error);
            });
        } else {
            console.warn("Không tìm thấy ID bài kiểm tra hoặc mã lớp trong URL.");
        }
    }
});
