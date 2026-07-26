// test.js
// Firebase SDK imports
import { auth, db } from "./firebase.js";
import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
    doc,
    addDoc,
    getDoc,
    updateDoc,
    query,
    collection,
    where,
    getDocs
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

let hasPageLoaded = false;
let cachedGradeResults = [];
let cachedGradeRole = null;
let cachedGradeClassCode = null;
let cachedGradeStudentInfo = {};
let openGradeStudentIds = new Set();
let gradeStateClassCode = null;

function getGradesOpenStateKey(classCode) {
    return `gradesOpenStudents:${classCode}`;
}

function captureOpenGradeStudentFolders() {
    const searchTerm = (document.getElementById('gradesSearchInput')?.value || '').trim();
    if (searchTerm) return;

    openGradeStudentIds = new Set(
        [...document.querySelectorAll('.grade-student-folder')]
            .filter(section => !section.querySelector('.grade-student-body')?.classList.contains('hidden'))
            .map(section => section.dataset.studentId)
            .filter(Boolean)
    );
}

function saveOpenGradeStudentFoldersForReturn(classCode = cachedGradeClassCode) {
    if (!classCode) return;
    captureOpenGradeStudentFolders();
    sessionStorage.setItem(getGradesOpenStateKey(classCode), JSON.stringify([...openGradeStudentIds]));
}

function restoreOpenGradeStudentFoldersForReturn(classCode) {
    if (!classCode) return;
    const saved = sessionStorage.getItem(getGradesOpenStateKey(classCode));

    if (saved) {
        try {
            const studentIds = JSON.parse(saved);
            openGradeStudentIds = new Set(Array.isArray(studentIds) ? studentIds : []);
        } catch (error) {
            console.warn("Could not restore grades folder state:", error);
            openGradeStudentIds = new Set();
        } finally {
            sessionStorage.removeItem(getGradesOpenStateKey(classCode));
            gradeStateClassCode = classCode;
        }
        return;
    }

    if (gradeStateClassCode !== classCode) {
        openGradeStudentIds = new Set();
        gradeStateClassCode = classCode;
    }
}


const testTitleInput = document.getElementById('test-title');
const questionsContainer = document.getElementById('questions');
const completeAndSaveButton = document.getElementById('completeAndSaveButton');
const testValidationMessage = document.getElementById('testValidationMessage');
const TEST_FOLDERS_SUBCOLLECTION = "testFolders";
const IELTS_PART_COUNT = 3;
let createParts = null;
let activeCreatePartIndex = 0;
let isRenderingCreatePart = false;
let examParts = null;
let activeExamPartIndex = 0;
let examAnswerState = {};
let expandedExamPartIndex = null;

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function sanitizeRichTextHtml(value = '') {
    const template = document.createElement('template');
    template.innerHTML = String(value || '');
    const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'SPAN', 'BR', 'DIV', 'P']);
    const allowedStyles = new Set(['color', 'font-size', 'font-weight', 'font-style']);

    const cleanNode = (node) => {
        if (node.nodeType === Node.TEXT_NODE) return;

        if (node.nodeType !== Node.ELEMENT_NODE || !allowedTags.has(node.tagName)) {
            if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'FONT') {
                const span = document.createElement('span');
                const color = node.getAttribute('color');
                if (color && (/^#[0-9a-f]{3,6}$/i.test(color) || /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i.test(color))) {
                    span.style.color = color;
                }
                span.innerHTML = node.innerHTML;
                node.replaceWith(span);
                cleanNode(span);
                return;
            }
            node.replaceWith(document.createTextNode(node.textContent || ''));
            return;
        }

        [...node.attributes].forEach(attribute => {
            if (attribute.name !== 'style') {
                node.removeAttribute(attribute.name);
                return;
            }

            const cleanedStyles = [];
            node.getAttribute('style').split(';').forEach(styleRule => {
                const [rawName, ...rawValueParts] = styleRule.split(':');
                const name = (rawName || '').trim().toLowerCase();
                const value = rawValueParts.join(':').trim();
                if (!allowedStyles.has(name)) return;
                if (name === 'font-size' && !/^\d{1,2}px$/.test(value)) return;
                if (name === 'font-weight' && !/^(400|500|600|700|bold|normal)$/.test(value)) return;
                if (name === 'font-style' && !/^(italic|normal)$/.test(value)) return;
                if (name === 'color' && !/^#[0-9a-f]{3,6}$/i.test(value) && !/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i.test(value)) return;
                cleanedStyles.push(`${name}: ${value}`);
            });

            if (cleanedStyles.length) {
                node.setAttribute('style', cleanedStyles.join('; '));
            } else {
                node.removeAttribute('style');
            }
        });

        [...node.childNodes].forEach(cleanNode);
    };

    [...template.content.childNodes].forEach(cleanNode);
    return template.innerHTML;
}

function richTextForEditor(value = '') {
    const raw = String(value || '');
    if (/<[a-z][\s\S]*>/i.test(raw)) {
        return sanitizeRichTextHtml(raw);
    }
    return escapeHtml(raw).replace(/\r?\n/g, '<br>');
}

function richTextForDisplay(value = '') {
    return sanitizeRichTextHtml(richTextForEditor(value));
}

function getRichTextHtml(root, selector) {
    return sanitizeRichTextHtml(root.querySelector(selector)?.innerHTML.trim() || '');
}

function buildRichTextToolbar() {
    return `
        <div class="rich-text-toolbar" aria-label="Text formatting tools">
            <button type="button" class="rich-tool-button" data-command="bold" title="Bold"><strong>B</strong></button>
            <button type="button" class="rich-tool-button" data-command="italic" title="Italic"><em>I</em></button>
            <select class="rich-tool-select" data-command="fontSize" title="Font size">
                <option value="">Size</option>
                <option value="14">14</option>
                <option value="16">16</option>
                <option value="18">18</option>
                <option value="20">20</option>
                <option value="24">24</option>
                <option value="28">28</option>
            </select>
            <label class="rich-tool-color" title="Text color">
                <span>Color</span>
                <input type="color" class="rich-tool-color-input" data-command="foreColor" value="#111827">
            </label>
            <button type="button" class="rich-tool-button rich-tool-black" data-command="foreColor" data-value="#111827" title="Black text">A</button>
        </div>
    `;
}

let activeRichTextEditor = null;
let savedRichTextRange = null;
let richEditorPointerDown = null;

function saveRichTextSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const editor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer.closest?.('[contenteditable="true"]')
        : range.commonAncestorContainer.parentElement?.closest?.('[contenteditable="true"]');
    if (!editor) return;
    activeRichTextEditor = editor;
    savedRichTextRange = range.cloneRange();
}

function restoreRichTextSelection() {
    if (!activeRichTextEditor) return false;
    activeRichTextEditor.focus();
    if (!savedRichTextRange) return true;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedRichTextRange);
    return true;
}

function wrapSelectionWithStyle(styles = {}) {
    if (!activeRichTextEditor || !savedRichTextRange) return false;
    const range = savedRichTextRange.cloneRange();
    if (!activeRichTextEditor.contains(range.commonAncestorContainer)) return false;

    const span = document.createElement('span');
    Object.entries(styles).forEach(([property, value]) => {
        span.style[property] = value;
    });

    if (range.collapsed) {
        span.appendChild(document.createTextNode('\u200b'));
        range.insertNode(span);
        const selection = window.getSelection();
        const newRange = document.createRange();
        newRange.selectNodeContents(span);
        newRange.collapse(false);
        selection.removeAllRanges();
        selection.addRange(newRange);
        activeRichTextEditor.focus();
        savedRichTextRange = newRange.cloneRange();
        return true;
    }

    span.appendChild(range.extractContents());
    range.insertNode(span);
    const selection = window.getSelection();
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    selection.removeAllRanges();
    selection.addRange(newRange);
    activeRichTextEditor.focus();
    savedRichTextRange = newRange.cloneRange();
    return true;
}

function getCaretRangeFromPoint(x, y) {
    if (document.caretRangeFromPoint) {
        return document.caretRangeFromPoint(x, y);
    }
    if (document.caretPositionFromPoint) {
        const position = document.caretPositionFromPoint(x, y);
        if (!position) return null;
        const range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
        return range;
    }
    return null;
}

function placeCaretInEditorFromPoint(editor, x, y) {
    const range = getCaretRangeFromPoint(x, y);
    if (!range || !editor.contains(range.startContainer)) return false;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    activeRichTextEditor = editor;
    savedRichTextRange = range.cloneRange();
    editor.focus();
    return true;
}

function hasSelectedRichText() {
    if (!savedRichTextRange) return false;
    return !savedRichTextRange.collapsed && String(savedRichTextRange.toString() || '').trim().length > 0;
}

function getSelectionStyleState(property) {
    if (!savedRichTextRange) return false;
    const node = savedRichTextRange.startContainer;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return false;
    const style = window.getComputedStyle(element);

    if (property === 'bold') {
        const weight = style.fontWeight;
        return weight === 'bold' || Number(weight) >= 600;
    }

    if (property === 'italic') {
        return style.fontStyle === 'italic';
    }

    return false;
}

function applyRichTextCommand(command, value = null) {
    if (!restoreRichTextSelection()) return;
    if (command === 'bold') {
        if (!hasSelectedRichText()) return;
        wrapSelectionWithStyle({ fontWeight: getSelectionStyleState('bold') ? '400' : '700' });
    } else if (command === 'italic') {
        if (!hasSelectedRichText()) return;
        wrapSelectionWithStyle({ fontStyle: getSelectionStyleState('italic') ? 'normal' : 'italic' });
    } else if (command === 'fontSize') {
        if (!value) return;
        wrapSelectionWithStyle({ fontSize: `${value}px` });
    } else if (command === 'foreColor') {
        wrapSelectionWithStyle({ color: value || '#111827' });
    } else {
        document.execCommand(command, false, value);
    }
    saveRichTextSelection();
    updateCompleteButtonState();
}

function syncRichColorInput(input) {
    const color = input?.value || '#111827';
    const wrapper = input?.closest('.rich-tool-color');
    if (wrapper) {
        wrapper.style.setProperty('--rich-color', color);
    }
}

function parseInlineBlanksFromContent(content = '') {
    const blanks = [];
    const errors = [];
    const seenNumbers = new Set();
    const tokenRegex = /\[{1,2}(\d+)([\/|])([^\]]+)\]{1,2}/g;
    let match;

    while ((match = tokenRegex.exec(content)) !== null) {
        const number = (match[1] || '').trim();
        const answer = (match[3] || '').trim();

        if (!number || !answer) {
            errors.push('invalid blank format');
            continue;
        }
        if (!/^\d+$/.test(number)) {
            errors.push(`blank ${number || '?'} number`);
            continue;
        }
        if (seenNumbers.has(number)) {
            errors.push(`blank ${number} duplicate`);
            continue;
        }

        seenNumbers.add(number);
        blanks.push({ number, answer });
    }

    const hasBrokenDoubleBlank = content.includes('[[') !== content.includes(']]');
    const hasLikelyBrokenSingleBlank = /\[\d+[\/|][^\]]*$/.test(content);
    if (hasBrokenDoubleBlank || hasLikelyBrokenSingleBlank) {
        errors.push('invalid blank format');
    } else if ((content.includes('[[') || /\[\d+[\/|]/.test(content)) && blanks.length === 0 && errors.length === 0) {
        errors.push('invalid blank format');
    }

    return { blanks, errors };
}

function getQuestionPointCount(question) {
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
}

function getQuestionNumbersFromRangeTitle(title = '', fallbackCount = 0) {
    const match = String(title).match(/(\d+)\s*[-–]\s*(\d+)/);
    if (!match) {
        return Array.from({ length: fallbackCount }, (_, index) => String(index + 1));
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
        return Array.from({ length: fallbackCount }, (_, index) => String(index + 1));
    }
    return Array.from({ length: Math.min(end - start + 1, fallbackCount) }, (_, index) => String(start + index));
}

function renderInlineBlankContent(content = '', sectionIndex = 0) {
    return content.replace(/\[{1,2}(\d+)[\/|]([^\]]+)\]{1,2}/g, (_token, number) => {
        const safeNumber = escapeHtml(String(number).trim());
        return `<span class="inline-blank-wrap"><span class="inline-blank-number">${safeNumber}</span><input class="inline-blank-answer" name="q-${sectionIndex}-${safeNumber}" data-blank-number="${safeNumber}" autocomplete="off"></span>`;
    });
}

function getDropdownWidthCh(options = []) {
    const longest = options.reduce((max, option) => Math.max(max, String(option).length), 1);
    return Math.min(Math.max(longest + 5, 6), 24);
}

function createEmptyPart(partNumber) {
    return {
        partNumber,
        instructions: '',
        questions: []
    };
}

function normalizeTestParts(test = {}) {
    if (Array.isArray(test.parts) && test.parts.length > 0) {
        return Array.from({ length: IELTS_PART_COUNT }, (_, index) => {
            const partNumber = index + 1;
            const existingPart = test.parts.find(part => Number(part.partNumber) === partNumber) || test.parts[index] || {};
            return {
                partNumber,
                instructions: existingPart.instructions || '',
                questions: Array.isArray(existingPart.questions) ? existingPart.questions : []
            };
        });
    }

    return Array.from({ length: IELTS_PART_COUNT }, (_, index) => (
        index === 0
            ? {
                partNumber: 1,
                instructions: test.instructions || '',
                questions: Array.isArray(test.questions) ? test.questions : []
            }
            : createEmptyPart(index + 1)
    ));
}

function getQuestionsPointCount(questions = []) {
    return questions.reduce((total, question) => total + getQuestionPointCount(question), 0);
}

function getPartQuestionCount(part) {
    return getQuestionsPointCount(part?.questions || []);
}

function renderQuestionData(questionData) {
    if (questionData?.type === 'multipleChoiceSection') {
        window.addMultipleChoiceSection(questionData);
    } else if (questionData?.type === 'inlineBlankSection') {
        window.addInlineBlankSection(questionData);
    } else if (questionData?.type === 'dropdownSection') {
        window.addDropdownSection(questionData);
    } else {
        window.addQuestion(questionData);
    }
}

function getCurrentQuestionsFromDom() {
    const qEls = document.querySelectorAll('#questions .question');
    return [...qEls].map(el => extractQuestionDataFromDom(el));
}

function commitCurrentCreatePart(updateNav = true) {
    if (!createParts || isRenderingCreatePart) return;
    const instructionsDiv = document.getElementById('test-instructions');
    createParts[activeCreatePartIndex] = {
        partNumber: activeCreatePartIndex + 1,
        instructions: sanitizeRichTextHtml(instructionsDiv?.innerHTML.trim() || ''),
        questions: getCurrentQuestionsFromDom()
    };
    if (updateNav) {
        renderCreatePartNav();
    }
}

function renderCreatePart(index) {
    if (!createParts) return;
    const instructionsContainer = document.getElementById('test-instructions');
    const questionsContainer = document.getElementById('questions');
    if (!instructionsContainer || !questionsContainer) return;

    activeRichTextEditor = null;
    savedRichTextRange = null;
    isRenderingCreatePart = true;
    activeCreatePartIndex = index;
    const part = createParts[index] || createEmptyPart(index + 1);
    instructionsContainer.innerHTML = richTextForEditor(part.instructions || '');
    questionsContainer.innerHTML = '';
    (part.questions || []).forEach(renderQuestionData);
    updateQuestionNumbers();
    isRenderingCreatePart = false;
    renderCreatePartNav();
    updateCompleteButtonState();
}

function renderCreatePartNav() {
    const nav = document.getElementById('create-part-nav');
    if (!nav || !createParts) return;

    nav.innerHTML = createParts.map((part, index) => {
        const count = getPartQuestionCount(part);
        return `
            <button type="button" class="part-tab ${index === activeCreatePartIndex ? 'active' : ''}" onclick="window.switchCreatePart(${index})">
                <span>Part ${index + 1}: <small>${count} Question${count === 1 ? '' : 's'}</small></span>
            </button>
        `;
    }).join('');
}

function switchCreatePart(index, options = {}) {
    if (!createParts || index === activeCreatePartIndex) return;
    if (options.commit !== false) {
        commitCurrentCreatePart(false);
    }
    renderCreatePart(index);
}

function initializeCreateParts(test = null) {
    createParts = normalizeTestParts(test || {});
    if (!test && createParts.every(part => (part.questions || []).length === 0)) {
        createParts[0].questions = [{ type: 'multipleChoiceSection' }];
    }
    activeCreatePartIndex = 0;
    renderCreatePart(0);
}

function getQuestionDataValidationErrors(questions = [], partNumber = 1) {
    const errors = [];
    questions.forEach((question, index) => {
        const sectionLabel = `part ${partNumber} section ${index + 1}`;
        if (question.type === 'multipleChoiceSection') {
            if (question.sectionMode === 'selectionSet') {
                const options = Array.isArray(question.options) ? question.options : [];
                const correctAnswers = Array.isArray(question.correctAnswers) ? question.correctAnswers : [];
                if (!question.title) {
                    errors.push(`${sectionLabel} title`);
                }
                if (options.length < 2) {
                    errors.push(`${sectionLabel} at least two statements`);
                }
                if (options.some(option => !String(option || '').trim())) {
                    errors.push(`${sectionLabel} statement text`);
                }
                if (correctAnswers.length === 0) {
                    errors.push(`${sectionLabel} correct statements`);
                }
                if (correctAnswers.length > options.length) {
                    errors.push(`${sectionLabel} correct statements`);
                }
                return;
            }

            const seenNumbers = new Set();
            if (!question.title) {
                errors.push(`${sectionLabel} title`);
            }
            if (!Array.isArray(question.items) || question.items.length === 0) {
                errors.push(`${sectionLabel} at least one item`);
            }
            (question.items || []).forEach((item, itemIndex) => {
                const number = String(item.number || '').trim();
                const choices = Array.isArray(item.choices) ? item.choices : [];
                const correctAnswers = Array.isArray(item.correctAnswers) ? item.correctAnswers : [];
                const itemLabel = `${sectionLabel} item ${itemIndex + 1}`;
                if (!number || !/^\d+$/.test(number)) {
                    errors.push(`${itemLabel} number`);
                } else if (seenNumbers.has(number)) {
                    errors.push(`${sectionLabel} item ${number} duplicate`);
                }
                if (number) seenNumbers.add(number);
                if (!String(item.prompt || '').trim()) {
                    errors.push(`${itemLabel} prompt`);
                }
                if (choices.length < 2) {
                    errors.push(`${itemLabel} at least two options`);
                }
                if (choices.some(choice => !String(choice || '').trim())) {
                    errors.push(`${itemLabel} option text`);
                }
                if (correctAnswers.length === 0) {
                    errors.push(`${itemLabel} correct answer`);
                }
                if ((item.mcqType || 'single') === 'single' && correctAnswers.length > 1) {
                    errors.push(`${itemLabel} only one correct answer`);
                }
            });
            return;
        }

        if (question.type === 'inlineBlankSection') {
            const plainContent = String(question.content || '').replace(/<[^>]+>/g, '').trim();
            const { blanks, errors: blankErrors } = parseInlineBlanksFromContent(question.content || '');
            if (!question.title) {
                errors.push(`${sectionLabel} title`);
            }
            if (!plainContent) {
                errors.push(`${sectionLabel} content`);
            }
            if (blankErrors.length > 0) {
                errors.push(`${sectionLabel} blank format`);
            }
            if (blanks.length === 0) {
                errors.push(`${sectionLabel} at least one blank`);
            }
            return;
        }

        if (question.type === 'dropdownSection') {
            const seenNumbers = new Set();
            if (!question.title) {
                errors.push(`${sectionLabel} title`);
            }
            if (!Array.isArray(question.options) || question.options.length === 0) {
                errors.push(`${sectionLabel} dropdown options`);
            }
            if (!Array.isArray(question.rows) || question.rows.length === 0) {
                errors.push(`${sectionLabel} at least one dropdown item`);
            }
            (question.rows || []).forEach((row, rowIndex) => {
                const number = String(row.number || '').trim();
                const itemLabel = `${sectionLabel} item ${rowIndex + 1}`;
                if (!number || !/^\d+$/.test(number)) {
                    errors.push(`${itemLabel} number`);
                } else if (seenNumbers.has(number)) {
                    errors.push(`${sectionLabel} item ${number} duplicate`);
                }
                if (number) seenNumbers.add(number);
                if (!String(row.prompt || '').trim()) {
                    errors.push(`${itemLabel} prompt`);
                }
                if (!String(row.answer || '').trim()) {
                    errors.push(`${itemLabel} answer`);
                }
            });
            return;
        }

        const questionLabel = `part ${partNumber} question ${index + 1}`;
        if (!String(question.qText || '').trim()) {
            errors.push(`${questionLabel} text`);
        }
        if (question.type === 'mcq') {
            const choices = Array.isArray(question.choices) ? question.choices : [];
            const correctAnswers = Array.isArray(question.correctAnswers) ? question.correctAnswers : [];
            if (choices.length < 2) {
                errors.push(`${questionLabel} at least two options`);
            }
            if (choices.some(choice => !String(choice || '').trim())) {
                errors.push(`${questionLabel} option text`);
            }
            if (correctAnswers.length === 0) {
                errors.push(`${questionLabel} correct answer`);
            }
            if ((question.mcqType || 'single') === 'single' && correctAnswers.length > 1) {
                errors.push(`${questionLabel} only one correct answer`);
            }
        } else if (question.type === 'text' && !String(question.answer || '').trim()) {
            errors.push(`${questionLabel} answer`);
        }
    });
    return errors;
}

function updateQuestionNumbers() {
    const questionsContainer = document.getElementById('questions');
    if (!questionsContainer) {
        console.error("Questions container not found for updating numbers.");
        return;
    }
    const questions = questionsContainer.querySelectorAll('.question');
    questions.forEach((questionDiv, index) => {
        let questionNumberElement = questionDiv.querySelector('.question-number');
        if (!questionNumberElement) {
            questionNumberElement = document.createElement('h3');
            questionNumberElement.className = 'question-number';
            questionDiv.prepend(questionNumberElement);
        }
        const hasRangeTitle = ['multipleChoiceSection', 'inlineBlankSection', 'dropdownSection'].includes(questionDiv.dataset.type);
        questionNumberElement.textContent = hasRangeTitle ? '' : `Question ${index + 1}`;
        questionNumberElement.classList.toggle('hidden-section-number', hasRangeTitle);
        const questionUniqueId = questionDiv.dataset.questionUniqueId || `q-${Date.now()}-${index}`;
        questionDiv.dataset.questionUniqueId = questionUniqueId;
        if (questionDiv.dataset.type === 'mcq') {
            const mcqChoiceType = questionDiv.dataset.mcqChoiceType || 'single';
            questionDiv.querySelectorAll('.mcq-option-input').forEach(input => {
                input.name = `correct-${questionUniqueId}`;
                input.type = mcqChoiceType === 'single' ? 'radio' : 'checkbox';
            });
        }
        const qTextInput = questionDiv.querySelector('.q-text');
        if (qTextInput) {
            qTextInput.id = `q-text-${index}`;
        }
        const qTypeSelect = questionDiv.querySelector('.q-type');
        if (qTypeSelect) {
            qTypeSelect.id = `q-type-${index}`;
        }
    });
    updateCompleteButtonState();
}

function getTestValidationErrors() {
    const errors = [];
    if (!testTitleInput || testTitleInput.value.trim() === '') {
        errors.push('test title');
    }
    const folderSelect = document.getElementById('test-folder-select');
    if (folderSelect && !folderSelect.value) {
        errors.push('folder');
    }
    const assignment = getSelectedAssignmentData();
    if (assignment.assignedTo === 'selected' && assignment.assignedStudentIds.length === 0) {
        errors.push('assignees');
    }

    if (createParts) {
        commitCurrentCreatePart(false);
        const totalQuestions = createParts.reduce((total, part) => total + getPartQuestionCount(part), 0);
        if (totalQuestions === 0) {
            errors.push('at least one question');
        }

        let firstInvalidPartIndex = null;
        createParts.forEach((part, index) => {
            const partErrors = getQuestionDataValidationErrors(part.questions || [], index + 1);
            if (partErrors.length > 0 && firstInvalidPartIndex === null) {
                firstInvalidPartIndex = index;
            }
            errors.push(...partErrors);
        });
        if (firstInvalidPartIndex !== null) {
            errors.partIndex = firstInvalidPartIndex;
        }
        renderCreatePartNav();
        return errors;
    }

    const questionEls = questionsContainer ? questionsContainer.querySelectorAll('.question') : [];
    if (questionEls.length === 0) {
        errors.push('at least one question');
        return errors;
    }
    for (const [index, el] of [...questionEls].entries()) {
        const questionNumber = index + 1;
        if (el.dataset.type === 'multipleChoiceSection') {
            const title = el.querySelector('.mcq-section-title')?.value.trim();
            if ((el.dataset.sectionMode || 'items') === 'selectionSet') {
                const options = [...el.querySelectorAll('.mcq-selection-option-text')].map(input => input.value.trim());
                const selectedCorrectAnswers = [...el.querySelectorAll('.mcq-selection-correct-input:checked')];
                if (!title) {
                    errors.push(`section ${questionNumber} title`);
                }
                if (options.length < 2) {
                    errors.push(`section ${questionNumber} at least two statements`);
                }
                if (options.some(option => option === '')) {
                    errors.push(`section ${questionNumber} statement text`);
                }
                if (selectedCorrectAnswers.length === 0) {
                    errors.push(`section ${questionNumber} correct statements`);
                }
                continue;
            }

            const items = [...el.querySelectorAll('.mcq-section-item-editor')];
            const seenNumbers = new Set();

            if (!title) {
                errors.push(`section ${questionNumber} title`);
            }
            if (items.length === 0) {
                errors.push(`section ${questionNumber} at least one item`);
            }
            items.forEach((item, itemIndex) => {
                const number = item.querySelector('.mcq-section-item-number')?.value.trim();
                const prompt = item.querySelector('.mcq-section-item-prompt')?.value.trim();
                const choices = [...item.querySelectorAll('.mcq-section-option-text')].map(input => input.value.trim());
                const selectedCorrectAnswers = [...item.querySelectorAll('.mcq-section-correct-input:checked')];
                const mcqType = item.dataset.mcqChoiceType || 'single';

                if (!number || !/^\d+$/.test(number)) {
                    errors.push(`section ${questionNumber} item ${itemIndex + 1} number`);
                } else if (seenNumbers.has(number)) {
                    errors.push(`section ${questionNumber} item ${number} duplicate`);
                }
                if (number) seenNumbers.add(number);
                if (!prompt) {
                    errors.push(`section ${questionNumber} item ${itemIndex + 1} prompt`);
                }
                if (choices.some(choice => choice === '')) {
                    errors.push(`section ${questionNumber} item ${itemIndex + 1} option text`);
                }
                if (choices.length < 2) {
                    errors.push(`section ${questionNumber} item ${itemIndex + 1} at least two options`);
                }
                if (selectedCorrectAnswers.length === 0) {
                    errors.push(`section ${questionNumber} item ${itemIndex + 1} correct answer`);
                }
                if (mcqType === 'single' && selectedCorrectAnswers.length > 1) {
                    errors.push(`section ${questionNumber} item ${itemIndex + 1} only one correct answer`);
                }
            });
            continue;
        }
        if (el.dataset.type === 'inlineBlankSection') {
            const title = el.querySelector('.inline-section-title')?.value.trim();
            const contentElement = el.querySelector('.inline-section-content');
            const content = contentElement?.innerHTML.trim() || '';
            const plainContent = contentElement?.textContent.trim() || '';
            const { blanks, errors: blankErrors } = parseInlineBlanksFromContent(content);

            if (!title) {
                errors.push(`section ${questionNumber} title`);
            }
            if (!plainContent) {
                errors.push(`section ${questionNumber} content`);
            }
            if (content.includes('[[') !== content.includes(']]') || blankErrors.length > 0) {
                errors.push(`section ${questionNumber} blank format`);
            }
            if (blanks.length === 0) {
                errors.push(`section ${questionNumber} at least one blank`);
            }
            continue;
        }
        if (el.dataset.type === 'dropdownSection') {
            const title = el.querySelector('.dropdown-section-title')?.value.trim();
            const options = getDropdownOptionsFromSection(el);
            const rows = [...el.querySelectorAll('.dropdown-row')];
            const seenNumbers = new Set();

            if (!title) {
                errors.push(`section ${questionNumber} title`);
            }
            if (options.length === 0) {
                errors.push(`section ${questionNumber} dropdown options`);
            }
            if (rows.length === 0) {
                errors.push(`section ${questionNumber} at least one dropdown item`);
            }
            rows.forEach((row, rowIndex) => {
                const number = row.querySelector('.dropdown-row-number')?.value.trim();
                const prompt = row.querySelector('.dropdown-row-prompt')?.value.trim();
                const answer = row.querySelector('.dropdown-row-answer')?.value.trim();
                if (!number) {
                    errors.push(`section ${questionNumber} item ${rowIndex + 1} number`);
                } else if (!/^\d+$/.test(number)) {
                    errors.push(`section ${questionNumber} item ${rowIndex + 1} number`);
                } else if (seenNumbers.has(number)) {
                    errors.push(`section ${questionNumber} item ${number} duplicate`);
                }
                if (number) seenNumbers.add(number);
                if (!prompt) {
                    errors.push(`section ${questionNumber} item ${rowIndex + 1} prompt`);
                }
                if (!answer) {
                    errors.push(`section ${questionNumber} item ${rowIndex + 1} answer`);
                }
            });
            continue;
        }

        const qText = el.querySelector('.q-text')?.innerHTML.trim();
        const type = el.querySelector('.q-type')?.value;
        if (!qText) {
            errors.push(`question ${questionNumber} text`);
        }
        if (type === 'mcq') {
            const choices = [...el.querySelectorAll('.mcq-option-text')].map(c => c.value.trim());
            const selectedCorrectAnswers = [...el.querySelectorAll('.mcq-option-input:checked')];
            const mcqType = el.dataset.mcqChoiceType || 'single';
            if (choices.some(c => c === '')) {
                errors.push(`question ${questionNumber} option text`);
            }
            if (choices.length < 2) {
                errors.push(`question ${questionNumber} at least two options`);
            }
            if (selectedCorrectAnswers.length === 0) {
                errors.push(`question ${questionNumber} correct answer`);
            }
            if (mcqType === 'single' && selectedCorrectAnswers.length > 1) {
                errors.push(`question ${questionNumber} only one correct answer`);
            }
        } else if (type === 'text') {
            const answer = el.querySelector('.text-answer')?.value.trim();
            if (!answer) {
                errors.push(`question ${questionNumber} answer`);
            }
        }
    }
    return errors;
}

function validateTestForm() {
    return getTestValidationErrors().length === 0;
}

function showTestValidationErrors(errors) {
    if (!testValidationMessage) return;
    const label = errors.length === 1 ? 'is required.' : 'are required.';
    const formattedErrors = errors.map(error => error.charAt(0).toUpperCase() + error.slice(1));
    testValidationMessage.textContent = `${formattedErrors.join(', ')} ${label}`;
    testValidationMessage.classList.toggle('hidden', errors.length === 0);
}

function updateCompleteButtonState() {
    if (createParts && !isRenderingCreatePart) {
        commitCurrentCreatePart(false);
        renderCreatePartNav();
    }
    if (completeAndSaveButton) {
        completeAndSaveButton.disabled = false;
    }
    if (testValidationMessage) {
        testValidationMessage.textContent = '';
        testValidationMessage.classList.add('hidden');
    }
}

function buildQuestionTypeSelector(selectedType = 'mcq') {
    return `
        <div class="question-type-selector">
            <label>Type:</label>
            <select onchange="window.changeQuestionType(this)" class="q-type">
                <option value="multipleChoiceSection" ${selectedType === 'multipleChoiceSection' ? 'selected' : ''}>Multiple choice section</option>
                ${selectedType === 'mcq' ? '<option value="mcq" selected>Legacy multiple choice</option>' : ''}
                ${selectedType === 'text' ? '<option value="text" selected>Short Answer</option>' : ''}
                <option value="inlineBlankSection" ${selectedType === 'inlineBlankSection' ? 'selected' : ''}>Note completion / Fill blanks</option>
                <option value="dropdownSection" ${selectedType === 'dropdownSection' ? 'selected' : ''}>Dropdown matching section</option>
            </select>
        </div>
    `;
}

function addQuestion(questionData = null) {
    const questionsContainer = document.getElementById('questions');
    if (!questionsContainer) {
        console.error("Questions container with ID 'questions' not found!");
        return;
    }
    const currentQuestionCount = questionsContainer.querySelectorAll('.question').length;
    const newQuestionNumber = currentQuestionCount + 1;
    const qDiv = document.createElement('div');
    qDiv.className = 'question question-item';
    qDiv.dataset.questionUniqueId = questionData?.id || `q-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const initialType = questionData ? questionData.type : 'multipleChoiceSection';
    if (initialType === 'multipleChoiceSection') {
        addMultipleChoiceSection(questionData);
        return;
    }
    if (initialType === 'inlineBlankSection') {
        addInlineBlankSection(questionData);
        return;
    }
    if (initialType === 'dropdownSection') {
        addDropdownSection(questionData);
        return;
    }
    qDiv.dataset.type = initialType;
    let questionContentHTML = `
        <div class="question-header-controls">
            <h3 class="question-number">Question ${newQuestionNumber}</h3>
            ${buildQuestionTypeSelector(initialType)}
        </div>
       ${buildRichTextToolbar()}
       <div contenteditable="true" class="q-text rich-question-text rich-section-editor" placeholder="Question Text *">${richTextForEditor(questionData ? questionData.qText || '' : '')}</div>
    `;
    if (initialType === 'mcq') {
        const initialMcqType = questionData && questionData.mcqType ? questionData.mcqType : 'single';
        qDiv.dataset.mcqChoiceType = initialMcqType;
        questionContentHTML += `
            <div class="mcq-options-container">
                <div class="mcq-choice-type">
                    <label>Type:</label>
                    <input type="radio" name="mcqType-${qDiv.dataset.questionUniqueId}" value="single"
                           id="mcqTypeSingle-${qDiv.dataset.questionUniqueId}"
                           onchange="window.setMcqChoiceType(this.closest('.question'), 'single')"
                           ${initialMcqType === 'single' ? 'checked' : ''}>
                    <label for="mcqTypeSingle-${qDiv.dataset.questionUniqueId}">Single Choice</label>
                    <input type="radio" name="mcqType-${qDiv.dataset.questionUniqueId}" value="multiple"
                           id="mcqTypeMultiple-${qDiv.dataset.questionUniqueId}"
                           onchange="window.setMcqChoiceType(this.closest('.question'), 'multiple')"
                           ${initialMcqType === 'multiple' ? 'checked' : ''}>
                    <label for="mcqTypeMultiple-${qDiv.dataset.questionUniqueId}">Multiple Choice</label>
                </div>
                <div class="options-list">
                </div>
                <button type="button" class="add-option-btn" onclick="window.addOption(this.closest('.question'))">+ Add Option</button>
                <button onclick="window.deleteQuestion(this)" class="delete-question-button">🗑 Delete Question</button>
            </div>
        `;
    } else {
        questionContentHTML += `
            <div class="text-answer-container">
                <input type="text" class="text-answer text-answer-input" placeholder="Correct Answer *" value="${questionData ? questionData.answer || '' : ''}" oninput="window.updateCompleteButtonState();" />
                <button onclick="window.deleteQuestion(this)" class="delete-question-button">🗑 Delete Question</button>
            </div>
        `;
    }
    qDiv.innerHTML = questionContentHTML;
    questionsContainer.appendChild(qDiv);
    qDiv.querySelectorAll('.rich-tool-color-input').forEach(syncRichColorInput);
    if (initialType === 'mcq') {
        const optionsListEl = qDiv.querySelector('.options-list');
        if (questionData && questionData.choices && questionData.choices.length > 0) {
            questionData.choices.forEach((choiceText, index) => {
                const isCorrect = questionData.correctAnswers && questionData.correctAnswers.includes(index);
                window.addOption(qDiv, choiceText, isCorrect);
            });
        } else {
            window.addOption(qDiv);
            window.addOption(qDiv);
            window.addOption(qDiv);
            window.addOption(qDiv);
        }
    }
    updateQuestionNumbers();
    updateCompleteButtonState();
}

function addInlineBlankSection(sectionData = null) {
    const questionsContainer = document.getElementById('questions');
    if (!questionsContainer) {
        console.error("Questions container with ID 'questions' not found!");
        return;
    }

    const sectionDiv = document.createElement('div');
    sectionDiv.className = 'question inline-section-editor';
    sectionDiv.dataset.type = 'inlineBlankSection';
    sectionDiv.dataset.questionUniqueId = sectionData?.id || `section-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    sectionDiv.innerHTML = `
        <div class="inline-section-editor-header">
            <h3 class="question-number">IELTS Section</h3>
            ${buildQuestionTypeSelector('inlineBlankSection')}
            <button type="button" class="delete-question-button" onclick="window.deleteQuestion(this)">Delete Section</button>
        </div>
        <label class="inline-section-field">
            <span>Title / Range *</span>
            <input type="text" class="inline-section-title" placeholder="Questions 5-8" value="${escapeHtml(sectionData?.title || '')}">
        </label>
        <label class="inline-section-field">
            <span>Instruction</span>
            ${buildRichTextToolbar()}
            <div contenteditable="true" class="inline-section-instruction rich-section-editor" placeholder="Example: Complete the notes below. Choose ONE WORD AND/OR A NUMBER for each answer.">${richTextForEditor(sectionData?.instruction || '')}</div>
        </label>
        <label class="inline-section-field">
            <span>Question text / notes *</span>
            ${buildRichTextToolbar()}
            <div contenteditable="true" class="inline-section-content rich-section-editor" placeholder="Example: The museum opened in [5/1998] and later moved to [6/London].">${sectionData?.content || ''}</div>
        </label>
        <p class="inline-section-hint">Put blanks in <strong>Question text / notes</strong>, not Instruction. Use <strong>[number/answer]</strong>, for example <strong>[5/1998]</strong>.</p>
    `;

    questionsContainer.appendChild(sectionDiv);
    sectionDiv.querySelectorAll('.rich-tool-color-input').forEach(syncRichColorInput);
    updateQuestionNumbers();
    updateCompleteButtonState();
}

function addMultipleChoiceSection(sectionData = null) {
    const questionsContainer = document.getElementById('questions');
    if (!questionsContainer) {
        console.error("Questions container with ID 'questions' not found!");
        return;
    }

    const sectionDiv = document.createElement('div');
    sectionDiv.className = 'question multiple-choice-section-editor';
    sectionDiv.dataset.type = 'multipleChoiceSection';
    sectionDiv.dataset.sectionMode = sectionData?.sectionMode || (Array.isArray(sectionData?.options) ? 'selectionSet' : 'items');
    sectionDiv.dataset.questionUniqueId = sectionData?.id || `mcq-section-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const sectionMode = sectionDiv.dataset.sectionMode;
    sectionDiv.innerHTML = `
        <div class="inline-section-editor-header">
            <h3 class="question-number">Multiple Choice Section</h3>
            ${buildQuestionTypeSelector('multipleChoiceSection')}
            <button type="button" class="delete-question-button" onclick="window.deleteQuestion(this)">Delete Section</button>
        </div>
        <label class="inline-section-field compact-field">
            <span>Multiple choice format</span>
            <select class="mcq-section-mode" onchange="window.setMultipleChoiceSectionMode(this.closest('.question'), this.value)">
                <option value="items" ${sectionMode === 'items' ? 'selected' : ''}>All-or-nothing</option>
                <option value="selectionSet" ${sectionMode === 'selectionSet' ? 'selected' : ''}>Per-answer scoring</option>
            </select>
        </label>
        <label class="inline-section-field">
            <span>Title / Range *</span>
            <input type="text" class="mcq-section-title" placeholder="Questions 18-22" value="${escapeHtml(sectionData?.title || '')}">
        </label>
        <label class="inline-section-field">
            <span>Instruction</span>
            ${buildRichTextToolbar()}
            <div contenteditable="true" class="mcq-section-instruction rich-section-editor" placeholder="Example: For each question, only ONE of the choices is correct.">${richTextForEditor(sectionData?.instruction || '')}</div>
        </label>
        <div class="mcq-items-mode">
            <div class="mcq-section-items"></div>
            <button type="button" class="add-option-btn" onclick="window.addMultipleChoiceItem(this.closest('.question'))">+ Add question item</button>
            <p class="inline-section-hint">Each item becomes one scored question. Use Single Choice for one answer or Multiple Choice for several correct answers.</p>
        </div>
        <div class="mcq-selection-mode">
            <div class="mcq-selection-options"></div>
            <button type="button" class="add-option-btn" onclick="window.addSelectionSetOption(this.closest('.question'))">+ Add statement</button>
            <p class="inline-section-hint">Tick every correct statement; each correct statement is worth 1 point.</p>
        </div>
    `;

    questionsContainer.appendChild(sectionDiv);
    sectionDiv.querySelectorAll('.rich-tool-color-input').forEach(syncRichColorInput);
    const items = Array.isArray(sectionData?.items) && sectionData.items.length > 0
        ? sectionData.items
        : [{ number: '1', prompt: '', mcqType: 'single', choices: ['', '', '', ''], correctAnswers: [] }];
    items.forEach(item => addMultipleChoiceItem(sectionDiv, item));
    const selectionOptions = Array.isArray(sectionData?.options) && sectionData.options.length > 0
        ? sectionData.options
        : ['', '', '', '', '', ''];
    selectionOptions.forEach((optionText, index) => {
        addSelectionSetOption(sectionDiv, optionText, Array.isArray(sectionData?.correctAnswers) && sectionData.correctAnswers.includes(index));
    });
    setMultipleChoiceSectionMode(sectionDiv, sectionMode);
    updateQuestionNumbers();
    updateCompleteButtonState();
}

function setMultipleChoiceSectionMode(sectionElement, mode) {
    sectionElement.dataset.sectionMode = mode;
    const modeSelect = sectionElement.querySelector('.mcq-section-mode');
    if (modeSelect) modeSelect.value = mode;
    const itemsMode = sectionElement.querySelector('.mcq-items-mode');
    const selectionMode = sectionElement.querySelector('.mcq-selection-mode');
    if (itemsMode) itemsMode.classList.toggle('hidden-editor-mode', mode !== 'items');
    if (selectionMode) selectionMode.classList.toggle('hidden-editor-mode', mode !== 'selectionSet');
    updateCompleteButtonState();
}

function getNextNumberFromInputs(container, selector) {
    const numbers = [...(container?.querySelectorAll(selector) || [])]
        .map(input => Number(String(input.value || '').trim()))
        .filter(number => Number.isInteger(number) && number > 0);
    if (numbers.length === 0) return 1;
    return numbers[numbers.length - 1] + 1;
}

function addSelectionSetOption(sectionElement, optionText = '', isCorrect = false) {
    const optionsContainer = sectionElement.querySelector('.mcq-selection-options');
    if (!optionsContainer) return;

    const optionIndex = optionsContainer.children.length;
    const option = document.createElement('div');
    option.className = 'mcq-selection-option-row';
    option.innerHTML = `
        <span class="mcq-letter-badge">${String.fromCharCode(65 + optionIndex)}</span>
        <input type="checkbox" class="mcq-selection-correct-input" value="${optionIndex}" ${isCorrect ? 'checked' : ''}>
        <input type="text" class="mcq-selection-option-text" placeholder="Statement text" value="${escapeHtml(optionText)}">
        <button type="button" class="remove-option-btn" onclick="window.removeSelectionSetOption(this.closest('.question'), this.closest('.mcq-selection-option-row'))">&times;</button>
    `;
    optionsContainer.appendChild(option);
    reIndexSelectionSetOptions(sectionElement);
    updateCompleteButtonState();
}

function removeSelectionSetOption(sectionElement, optionElement) {
    const optionsContainer = sectionElement.querySelector('.mcq-selection-options');
    if (!optionsContainer || optionsContainer.children.length <= 2) {
        alert("A statement selection section must have at least 2 statements.");
        return;
    }
    optionElement.remove();
    reIndexSelectionSetOptions(sectionElement);
    updateCompleteButtonState();
}

function reIndexSelectionSetOptions(sectionElement) {
    [...sectionElement.querySelectorAll('.mcq-selection-option-row')].forEach((row, index) => {
        const badge = row.querySelector('.mcq-letter-badge');
        const input = row.querySelector('.mcq-selection-correct-input');
        if (badge) badge.textContent = String.fromCharCode(65 + index);
        if (input) input.value = index;
    });
}

function addMultipleChoiceItem(sectionElement, itemData = null) {
    const itemsContainer = sectionElement.querySelector('.mcq-section-items');
    if (!itemsContainer) return;

    const itemIndex = itemsContainer.children.length;
    const nextNumber = getNextNumberFromInputs(itemsContainer, '.mcq-section-item-number');
    const itemId = itemData?.id || `mcq-item-${Date.now()}-${Math.floor(Math.random() * 10000)}-${itemIndex}`;
    const mcqType = itemData?.mcqType || 'single';
    const item = document.createElement('div');
    item.className = 'mcq-section-item-editor';
    item.dataset.itemId = itemId;
    item.dataset.mcqChoiceType = mcqType;
    item.innerHTML = `
        <div class="mcq-section-item-top">
            <input type="text" class="mcq-section-item-number" placeholder="#" value="${escapeHtml(itemData?.number || String(nextNumber))}">
            <input type="text" class="mcq-section-item-prompt" placeholder="Question prompt" value="${escapeHtml(itemData?.prompt || '')}">
            <select class="mcq-section-choice-type" onchange="window.setMultipleChoiceItemType(this.closest('.mcq-section-item-editor'), this.value)">
                <option value="single" ${mcqType === 'single' ? 'selected' : ''}>Single Choice</option>
                <option value="multiple" ${mcqType === 'multiple' ? 'selected' : ''}>Multiple Choice</option>
            </select>
            <button type="button" class="remove-option-btn" onclick="window.removeMultipleChoiceItem(this.closest('.mcq-section-item-editor'))">&times;</button>
        </div>
        <div class="mcq-section-options"></div>
        <button type="button" class="add-option-btn" onclick="window.addMultipleChoiceOption(this.closest('.mcq-section-item-editor'))">+ Add option</button>
    `;
    itemsContainer.appendChild(item);

    const choices = Array.isArray(itemData?.choices) && itemData.choices.length > 0
        ? itemData.choices
        : ['', '', '', ''];
    choices.forEach((choice, index) => {
        addMultipleChoiceOption(item, choice, Array.isArray(itemData?.correctAnswers) && itemData.correctAnswers.includes(index));
    });
    if (createParts && !isRenderingCreatePart) {
        commitCurrentCreatePart(false);
        renderCreatePartNav();
    }
    updateCompleteButtonState();
}

function addMultipleChoiceOption(itemElement, optionText = '', isCorrect = false) {
    const optionsContainer = itemElement.querySelector('.mcq-section-options');
    if (!optionsContainer) return;

    const optionIndex = optionsContainer.children.length;
    const inputType = itemElement.dataset.mcqChoiceType === 'multiple' ? 'checkbox' : 'radio';
    const inputName = `correct-${itemElement.dataset.itemId}`;
    const option = document.createElement('div');
    option.className = 'mcq-section-option-row';
    option.innerHTML = `
        <span class="mcq-letter-badge">${String.fromCharCode(65 + optionIndex)}</span>
        <input type="${inputType}" name="${inputName}" class="mcq-section-correct-input" value="${optionIndex}" ${isCorrect ? 'checked' : ''}>
        <input type="text" class="mcq-section-option-text" placeholder="Option text" value="${escapeHtml(optionText)}">
        <button type="button" class="remove-option-btn" onclick="window.removeMultipleChoiceOption(this.closest('.mcq-section-item-editor'), this.closest('.mcq-section-option-row'))">&times;</button>
    `;
    optionsContainer.appendChild(option);
    reIndexMultipleChoiceOptions(itemElement);
    updateCompleteButtonState();
}

function removeMultipleChoiceOption(itemElement, optionElement) {
    const optionsContainer = itemElement.querySelector('.mcq-section-options');
    if (!optionsContainer || optionsContainer.children.length <= 2) {
        alert("A multiple-choice item must have at least 2 options.");
        return;
    }
    optionElement.remove();
    reIndexMultipleChoiceOptions(itemElement);
    updateCompleteButtonState();
}

function removeMultipleChoiceItem(itemElement) {
    const itemsContainer = itemElement?.closest('.mcq-section-items');
    if (!itemsContainer) return;
    if (itemsContainer.children.length <= 1) {
        alert("A multiple-choice section must have at least one item.");
        return;
    }
    itemElement.remove();
    updateCompleteButtonState();
}

function setMultipleChoiceItemType(itemElement, type) {
    itemElement.dataset.mcqChoiceType = type;
    reIndexMultipleChoiceOptions(itemElement);
    if (type === 'single') {
        const checkedInputs = [...itemElement.querySelectorAll('.mcq-section-correct-input:checked')];
        checkedInputs.forEach((input, index) => {
            if (index > 0) input.checked = false;
        });
    }
    updateCompleteButtonState();
}

function reIndexMultipleChoiceOptions(itemElement) {
    const inputType = itemElement.dataset.mcqChoiceType === 'multiple' ? 'checkbox' : 'radio';
    const inputName = `correct-${itemElement.dataset.itemId}`;
    [...itemElement.querySelectorAll('.mcq-section-option-row')].forEach((row, index) => {
        const badge = row.querySelector('.mcq-letter-badge');
        const input = row.querySelector('.mcq-section-correct-input');
        if (badge) badge.textContent = String.fromCharCode(65 + index);
        if (input) {
            input.type = inputType;
            input.name = inputName;
            input.value = index;
        }
    });
}

function getDropdownOptionsFromSection(sectionElement) {
    const rawOptions = sectionElement.querySelector('.dropdown-section-options')?.value || '';
    return rawOptions
        .split(/\r?\n/)
        .map(option => option.trim())
        .filter(Boolean);
}

function refreshDropdownRowAnswerOptions(sectionElement) {
    const options = getDropdownOptionsFromSection(sectionElement);
    sectionElement.querySelectorAll('.dropdown-row-answer').forEach(select => {
        const currentValue = select.value;
        select.innerHTML = '<option value="">Correct answer</option>' + options.map(option => (
            `<option value="${escapeHtml(option)}" ${option === currentValue ? 'selected' : ''}>${escapeHtml(option)}</option>`
        )).join('');
    });
}

function addDropdownSection(sectionData = null) {
    const questionsContainer = document.getElementById('questions');
    if (!questionsContainer) {
        console.error("Questions container with ID 'questions' not found!");
        return;
    }

    const sectionDiv = document.createElement('div');
    sectionDiv.className = 'question dropdown-section-editor';
    sectionDiv.dataset.type = 'dropdownSection';
    sectionDiv.dataset.questionUniqueId = sectionData?.id || `dropdown-section-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const options = Array.isArray(sectionData?.options) && sectionData.options.length > 0
        ? sectionData.options
        : [];
    sectionDiv.innerHTML = `
        <div class="inline-section-editor-header">
            <h3 class="question-number">Dropdown Section</h3>
            ${buildQuestionTypeSelector('dropdownSection')}
            <button type="button" class="delete-question-button" onclick="window.deleteQuestion(this)">Delete Section</button>
        </div>
        <label class="inline-section-field">
            <span>Title / Range *</span>
            <input type="text" class="dropdown-section-title" placeholder="Questions 1-4" value="${escapeHtml(sectionData?.title || '')}">
        </label>
        <label class="inline-section-field">
            <span>Instruction</span>
            ${buildRichTextToolbar()}
            <div contenteditable="true" class="dropdown-section-instruction rich-section-editor" placeholder="Which paragraph contains each piece of information?">${richTextForEditor(sectionData?.instruction || '')}</div>
        </label>
        <label class="inline-section-field">
            <span>Dropdown options *</span>
            <textarea class="dropdown-section-options" placeholder="A&#10;B&#10;C&#10;&#10;or&#10;&#10;TRUE&#10;FALSE&#10;NOT GIVEN">${escapeHtml(options.join('\n'))}</textarea>
        </label>
        <div class="dropdown-rows"></div>
        <button type="button" class="add-option-btn" onclick="window.addDropdownRow(this.closest('.question'))">+ Add dropdown item</button>
        <p class="inline-section-hint">Put one option per line, for example A, B, C or TRUE, FALSE, NOT GIVEN.</p>
    `;

    questionsContainer.appendChild(sectionDiv);
    sectionDiv.querySelectorAll('.rich-tool-color-input').forEach(syncRichColorInput);
    const rows = Array.isArray(sectionData?.rows) && sectionData.rows.length > 0
        ? sectionData.rows
        : [{ number: '1', prompt: '', answer: '' }];
    rows.forEach(row => addDropdownRow(sectionDiv, row));
    sectionDiv.querySelector('.dropdown-section-options')?.addEventListener('input', () => {
        refreshDropdownRowAnswerOptions(sectionDiv);
        updateCompleteButtonState();
    });
    updateQuestionNumbers();
    updateCompleteButtonState();
}

function addDropdownRow(sectionElement, rowData = null) {
    const rowsContainer = sectionElement.querySelector('.dropdown-rows');
    if (!rowsContainer) return;
    const options = getDropdownOptionsFromSection(sectionElement);
    const nextNumber = getNextNumberFromInputs(rowsContainer, '.dropdown-row-number');
    const row = document.createElement('div');
    row.className = 'dropdown-row';
    row.innerHTML = `
        <input type="text" class="dropdown-row-number" placeholder="#" value="${escapeHtml(rowData?.number || String(nextNumber))}">
        <select class="dropdown-row-answer">
            <option value="">Correct answer</option>
            ${options.map(option => `<option value="${escapeHtml(option)}" ${option === rowData?.answer ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
        </select>
        <input type="text" class="dropdown-row-prompt" placeholder="Prompt text" value="${escapeHtml(rowData?.prompt || '')}">
        <button type="button" class="remove-option-btn" onclick="window.removeDropdownRow(this.closest('.dropdown-row'))">&times;</button>
    `;
    rowsContainer.appendChild(row);
    updateCompleteButtonState();
}

function removeDropdownRow(rowElement) {
    const rowsContainer = rowElement?.closest('.dropdown-rows');
    if (!rowsContainer) return;
    if (rowsContainer.children.length <= 1) {
        alert("A dropdown section must have at least one item.");
        return;
    }
    rowElement.remove();
    updateCompleteButtonState();
}

function addOption(questionElement, optionText = '', isCorrect = false) {
    const optionsList = questionElement.querySelector('.options-list');
    if (!optionsList) {
        console.error("Options list not found in question element.");
        return;
    }
    const optionDiv = document.createElement('div');
    optionDiv.classList.add('option-item');
    const questionUniqueId = questionElement.dataset.questionUniqueId;
    const mcqType = questionElement.dataset.mcqChoiceType || 'single';
    const inputType = mcqType === 'single' ? 'radio' : 'checkbox';
    const inputName = `correct-${questionUniqueId}`;
    const tempIndex = optionsList.children.length;
    optionDiv.innerHTML = `
        <label class="option-label">
            <input type="${inputType}" name="${inputName}" class="mcq-option-input" value="${tempIndex}" ${isCorrect ? 'checked' : ''}
                   onchange="window.updateCompleteButtonState();">
            <input type="text" class="mcq-option-text option-text-input" placeholder="Option text" value="${optionText}"
                   oninput="window.updateCompleteButtonState()">
        </label>
        <button type="button" class="remove-option-btn" onclick="window.removeOption(this.closest('.question'), this.closest('.option-item'))">&times;</button>
    `;
    optionsList.appendChild(optionDiv);
    window.reIndexOptions(questionElement);
    updateCompleteButtonState();
}

function removeOption(questionElement, optionItemElement) {
    const optionsList = questionElement.querySelector('.options-list');
    if (optionsList.children.length <= 2) {
        alert("A multiple-choice question must have at least 2 options.");
        return;
    }
    optionsList.removeChild(optionItemElement);
    window.reIndexOptions(questionElement);
    updateCompleteButtonState();
}

function setMcqChoiceType(questionElement, type) {
    questionElement.dataset.mcqChoiceType = type;
    const optionsInputs = questionElement.querySelectorAll('.mcq-option-input');
    optionsInputs.forEach(input => {
        input.type = type === 'single' ? 'radio' : 'checkbox';
    });
    if (type === 'single') {
        const checkedInputs = [...questionElement.querySelectorAll('.mcq-option-input:checked')];
        if (checkedInputs.length > 1) {
            checkedInputs.forEach((input, index) => {
                if (index > 0) {
                    input.checked = false;
                }
            });
        }
    }
    updateCompleteButtonState();
}

function reIndexOptions(questionElement) {
    const optionsList = questionElement.querySelector('.options-list');
    const questionUniqueId = questionElement.dataset.questionUniqueId;
    const mcqType = questionElement.dataset.mcqChoiceType || 'single';
    const inputType = mcqType === 'single' ? 'radio' : 'checkbox';
    const inputName = `correct-${questionUniqueId}`;
    Array.from(optionsList.children).forEach((optionDiv, index) => {
        const input = optionDiv.querySelector('.mcq-option-input');
        if (input) {
            input.value = index;
            input.name = inputName;
            input.type = inputType;
        }
    });
}

function changeQuestionType(selectEl) {
    const parent = selectEl.closest('.question');
    const newType = selectEl.value;
    const currentData = extractQuestionDataFromDom(parent);
    currentData.type = newType;
    const questionsContainer = document.getElementById('questions');
    const currentIndex = Array.from(questionsContainer.children).indexOf(parent);
    parent.remove();
    window.addQuestion(currentData);
    const newQ = questionsContainer.lastChild;
    if (currentIndex >= 0 && questionsContainer.children[currentIndex]) {
        questionsContainer.insertBefore(newQ, questionsContainer.children[currentIndex]);
    }
    if (newType === 'mcq') {
        window.setMcqChoiceType(newQ, newQ.dataset.mcqChoiceType);
    }
    updateQuestionNumbers();
    updateCompleteButtonState();
}

function extractQuestionDataFromDom(questionElement) {
    const type = questionElement.dataset.type;
    if (type === 'multipleChoiceSection') {
        const sectionMode = questionElement.dataset.sectionMode || 'items';
        if (sectionMode === 'selectionSet') {
            const options = [];
            const correctAnswers = [];
            questionElement.querySelectorAll('.mcq-selection-option-row').forEach((row, index) => {
                options.push(row.querySelector('.mcq-selection-option-text')?.value.trim() || '');
                if (row.querySelector('.mcq-selection-correct-input')?.checked) {
                    correctAnswers.push(index);
                }
            });
            return {
                id: questionElement.dataset.questionUniqueId,
                type: 'multipleChoiceSection',
                sectionMode: 'selectionSet',
                title: questionElement.querySelector('.mcq-section-title')?.value.trim() || '',
                instruction: getRichTextHtml(questionElement, '.mcq-section-instruction'),
                options,
                correctAnswers,
                questionNumbers: getQuestionNumbersFromRangeTitle(
                    questionElement.querySelector('.mcq-section-title')?.value.trim() || '',
                    correctAnswers.length
                )
            };
        }

        const items = [...questionElement.querySelectorAll('.mcq-section-item-editor')].map(item => {
            const choices = [];
            const correctAnswers = [];
            item.querySelectorAll('.mcq-section-option-row').forEach((row, index) => {
                const optionText = row.querySelector('.mcq-section-option-text')?.value.trim() || '';
                choices.push(optionText);
                if (row.querySelector('.mcq-section-correct-input')?.checked) {
                    correctAnswers.push(index);
                }
            });
            return {
                id: item.dataset.itemId,
                number: item.querySelector('.mcq-section-item-number')?.value.trim() || '',
                prompt: item.querySelector('.mcq-section-item-prompt')?.value.trim() || '',
                mcqType: item.dataset.mcqChoiceType || 'single',
                choices,
                correctAnswers
            };
        });
        return {
            id: questionElement.dataset.questionUniqueId,
            type: 'multipleChoiceSection',
            sectionMode: 'items',
            title: questionElement.querySelector('.mcq-section-title')?.value.trim() || '',
            instruction: getRichTextHtml(questionElement, '.mcq-section-instruction'),
            items
        };
    }
    if (type === 'inlineBlankSection') {
        const content = questionElement.querySelector('.inline-section-content')?.innerHTML.trim() || '';
        const { blanks } = parseInlineBlanksFromContent(content);
        return {
            id: questionElement.dataset.questionUniqueId,
            type: 'inlineBlankSection',
            title: questionElement.querySelector('.inline-section-title')?.value.trim() || '',
            instruction: getRichTextHtml(questionElement, '.inline-section-instruction'),
            content,
            blanks
        };
    }
    if (type === 'dropdownSection') {
        const rows = [...questionElement.querySelectorAll('.dropdown-row')].map(row => ({
            number: row.querySelector('.dropdown-row-number')?.value.trim() || '',
            prompt: row.querySelector('.dropdown-row-prompt')?.value.trim() || '',
            answer: row.querySelector('.dropdown-row-answer')?.value.trim() || ''
        }));
        return {
            id: questionElement.dataset.questionUniqueId,
            type: 'dropdownSection',
            title: questionElement.querySelector('.dropdown-section-title')?.value.trim() || '',
            instruction: getRichTextHtml(questionElement, '.dropdown-section-instruction'),
            options: getDropdownOptionsFromSection(questionElement),
            rows
        };
    }

    const qText = getRichTextHtml(questionElement, '.q-text');
    const questionUniqueId = questionElement.dataset.questionUniqueId;
    let data = {
        id: questionUniqueId,
        type: type,
        qText: qText,
    };
    if (type === 'mcq') {
        const choices = [];
        const correctAnswers = [];
        const mcqType = questionElement.dataset.mcqChoiceType || 'single';
        questionElement.querySelectorAll('.option-item').forEach((optionItem, index) => {
            const optionText = optionItem.querySelector('.mcq-option-text')?.value.trim() || '';
            const isChecked = optionItem.querySelector('.mcq-option-input')?.checked;
            choices.push(optionText);
            if (isChecked) {
                correctAnswers.push(index);
            }
        });
        data.mcqType = mcqType;
        data.choices = choices;
        data.correctAnswers = correctAnswers;
    } else if (type === 'text') {
        data.answer = questionElement.querySelector('.text-answer')?.value.trim() || '';
    }
    return data;
}

function deleteQuestion(btn) {
    btn.closest('.question').remove();
    updateQuestionNumbers();
    updateCompleteButtonState();
}

// Make functions globally accessible for event listeners in HTML
window.addQuestion = addQuestion;
window.addMultipleChoiceSection = addMultipleChoiceSection;
window.addMultipleChoiceItem = addMultipleChoiceItem;
window.addMultipleChoiceOption = addMultipleChoiceOption;
window.addSelectionSetOption = addSelectionSetOption;
window.removeMultipleChoiceOption = removeMultipleChoiceOption;
window.removeMultipleChoiceItem = removeMultipleChoiceItem;
window.removeSelectionSetOption = removeSelectionSetOption;
window.setMultipleChoiceItemType = setMultipleChoiceItemType;
window.setMultipleChoiceSectionMode = setMultipleChoiceSectionMode;
window.addInlineBlankSection = addInlineBlankSection;
window.addDropdownSection = addDropdownSection;
window.addDropdownRow = addDropdownRow;
window.removeDropdownRow = removeDropdownRow;
window.removeOption = removeOption;
window.addOption = addOption;
window.setMcqChoiceType = setMcqChoiceType;
window.reIndexOptions = reIndexOptions;
window.changeQuestionType = changeQuestionType;
window.deleteQuestion = deleteQuestion;
window.updateCompleteButtonState = updateCompleteButtonState;
window.applyRichTextCommand = applyRichTextCommand;
// --- END: DOM ELEMENTS & UTILITY FUNCTIONS ---


// --- START: FIREBASE DATA MANAGEMENT FUNCTIONS ---
function getCurrentUserUid() {
    const user = auth.currentUser;
    return user ? user.uid : null;
}

function isTestAssignedToUser(test, userId, userRole = 'student') {
    if (userRole === 'teacher') return true;
    if (!test || test.assignedTo !== 'selected') return true;
    const assignedStudentIds = Array.isArray(test.assignedStudentIds) ? test.assignedStudentIds : [];
    return assignedStudentIds.includes(userId);
}

async function getCurrentUserClassRole(classCode, userId) {
    if (!classCode || !userId) return 'student';
    try {
        const classSnap = await getDoc(doc(db, "classes", classCode));
        const members = classSnap.exists() && Array.isArray(classSnap.data().members) ? classSnap.data().members : [];
        return members.find(member => member.id === userId)?.role || 'student';
    } catch (error) {
        console.error("Error loading class role:", error);
        return 'student';
    }
}

async function loadTestFolderOptions(selectedFolderId = '') {
    const folderSelect = document.getElementById('test-folder-select');
    if (!folderSelect) return;

    const urlParams = new URLSearchParams(window.location.search);
    const classCode = urlParams.get('classCode');
    const requestedFolderId = selectedFolderId || urlParams.get('folderId') || '';
    folderSelect.innerHTML = '<option value="">Select a folder</option>';
    folderSelect.disabled = true;
    if (!classCode) return;

    try {
        const foldersSnapshot = await getDocs(query(collection(db, "classes", classCode, TEST_FOLDERS_SUBCOLLECTION)));
        const folders = [];
        foldersSnapshot.forEach((folderDoc) => folders.push({ id: folderDoc.id, ...folderDoc.data() }));
        folders.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        if (folders.length === 0) {
            updateCompleteButtonState();
            return;
        }

        folderSelect.disabled = false;
        folders.forEach((folder) => {
            const option = document.createElement('option');
            option.value = folder.id;
            option.textContent = folder.name || 'Untitled folder';
            folderSelect.appendChild(option);
        });
        if (requestedFolderId && folders.some(folder => folder.id === requestedFolderId)) {
            folderSelect.value = requestedFolderId;
        } else if (folders.length === 1) {
            folderSelect.value = folders[0].id;
        } else {
            folderSelect.value = '';
        }
        updateCompleteButtonState();
    } catch (error) {
        console.error("Error loading test folders:", error);
        updateCompleteButtonState();
    }
}

function getSelectedAssignmentData() {
    const selectedMode = document.querySelector('input[name="assignmentMode"]:checked')?.value || 'everyone';
    const selectedStudentIds = [...document.querySelectorAll('.assignment-student-checkbox:checked')]
        .map(input => input.value)
        .filter(Boolean);

    return {
        assignedTo: selectedMode === 'selected' ? 'selected' : 'everyone',
        assignedStudentIds: selectedMode === 'selected' ? selectedStudentIds : []
    };
}

function updateAssignmentVisibility() {
    const selectedMode = document.querySelector('input[name="assignmentMode"]:checked')?.value || 'everyone';
    const studentsList = document.getElementById('assignmentStudentsList');
    if (studentsList) {
        studentsList.classList.toggle('hidden', selectedMode !== 'selected');
    }
    updateCompleteButtonState();
}

async function loadAssignmentOptions(test = null) {
    const studentsList = document.getElementById('assignmentStudentsList');
    const emptyMessage = document.getElementById('assignmentEmptyMessage');
    const modeInputs = [...document.querySelectorAll('input[name="assignmentMode"]')];
    if (!studentsList || modeInputs.length === 0) return;

    const urlParams = new URLSearchParams(window.location.search);
    const classCode = urlParams.get('classCode');
    const selectedIds = new Set(Array.isArray(test?.assignedStudentIds) ? test.assignedStudentIds : []);
    const assignedTo = test?.assignedTo === 'selected' ? 'selected' : 'everyone';

    modeInputs.forEach(input => {
        input.checked = input.value === assignedTo;
        input.addEventListener('change', updateAssignmentVisibility);
    });

    studentsList.innerHTML = '';
    if (!classCode) {
        updateAssignmentVisibility();
        return;
    }

    try {
        const classSnap = await getDoc(doc(db, "classes", classCode));
        const classData = classSnap.exists() ? classSnap.data() : {};
        const students = (Array.isArray(classData.members) ? classData.members : [])
            .filter(member => member.role === 'student')
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        if (students.length === 0) {
            emptyMessage?.classList.remove('hidden');
        } else {
            emptyMessage?.classList.add('hidden');
        }

        students.forEach(student => {
            const label = document.createElement('label');
            label.className = 'assignment-student-option';
            label.innerHTML = `
                <input type="checkbox" class="assignment-student-checkbox" value="${escapeHtml(student.id || '')}" ${selectedIds.has(student.id) ? 'checked' : ''}>
                <span>${escapeHtml(student.name || student.email || 'Unnamed student')}</span>
            `;
            label.querySelector('input')?.addEventListener('change', updateCompleteButtonState);
            studentsList.appendChild(label);
        });
        updateAssignmentVisibility();
    } catch (error) {
        console.error("Error loading assignment options:", error);
        updateAssignmentVisibility();
    }
}

async function saveTest() {
    return window.withButtonLock(document.getElementById('completeAndSaveButton'), async () => {
    const validationErrors = getTestValidationErrors();
    if (validationErrors.length > 0) {
        if (Number.isInteger(validationErrors.partIndex)) {
            switchCreatePart(validationErrors.partIndex, { commit: false });
        }
        showTestValidationErrors(validationErrors);
        return;
    }

    const title = document.getElementById('test-title').value.trim();
    const instructionsDiv = document.getElementById('test-instructions');
    const userId = getCurrentUserUid();
    
    if (!userId) {
        alert("You need to log in to save your test.");
        return;
    }

    if (createParts) {
        commitCurrentCreatePart(false);
    }
    const partsToSave = createParts || normalizeTestParts({
        instructions: sanitizeRichTextHtml(instructionsDiv.innerHTML.trim()),
        questions: getCurrentQuestionsFromDom()
    });
    const instructionsContent = partsToSave[0]?.instructions || '';
    const instructions = instructionsContent.trim();
    const timer = +document.getElementById('test-timer')?.value || 0;
    const folderId = document.getElementById('test-folder-select')?.value || null;
    const questionsToSave = partsToSave[0]?.questions || [];
    const assignment = getSelectedAssignmentData();

    // Lấy giá trị từ các trường ngày giờ
    const startTimeInput = document.getElementById('start-time').value;
    const endTimeInput = document.getElementById('end-time').value;

    const urlParams = new URLSearchParams(window.location.search);
    const classCode = urlParams.get('classCode');
    const testIdToEdit = urlParams.get('testId');

    if (!classCode) {
        alert("Error: Class code not found in URL. Unable to save test.");
        return;
    }

    try {
        const newTest = {
            title,
            instructions,
            questions: questionsToSave,
            parts: partsToSave,
            timer,
            folderId,
            assignedTo: assignment.assignedTo,
            assignedStudentIds: assignment.assignedStudentIds,
            createdBy: userId,
            updatedAt: new Date(),
            // Lưu giá trị ngày giờ. Sẽ là null nếu người dùng không nhập
            startTime: startTimeInput ? new Date(startTimeInput) : null,
            endTime: endTimeInput ? new Date(endTimeInput) : null
        };

        const testSubCollectionRef = collection(db, "classes", classCode, "tests");
        
        let testRef;
        if (testIdToEdit) {
            testRef = doc(testSubCollectionRef, testIdToEdit);
            await updateDoc(testRef, newTest);
            console.log("Bài kiểm tra đã được cập nhật với ID: ", testIdToEdit);
        } else {
            testRef = await addDoc(testSubCollectionRef, {
                ...newTest,
                createdAt: new Date()
            });
            console.log("Bài kiểm tra đã được thêm với ID: ", testRef.id);
        }

        location.href = `class.html?classCode=${classCode}&tab=classwork`;

    } catch (e) {
        console.error("Lỗi khi lưu bài kiểm tra vào Firestore: ", e);
        alert("Error saving test. Please try again.");
    }
    });
}
window.saveTest = saveTest;

async function loadEditTestIfAny() {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('testId');
    if (!id) {
        console.log("Không có bài kiểm tra nào để chỉnh sửa.");
        return;
    }
    try {
        const classCode = urlParams.get('classCode'); 
        if (!id || !classCode) {
            console.log("Không có bài kiểm tra nào để chỉnh sửa hoặc thiếu mã lớp.");
            return;
        }
        const testDocRef = doc(db, "classes", classCode, "tests", id);
        const testDocSnap = await getDoc(testDocRef);
        if (!testDocSnap.exists()) {
            console.error("Không tìm thấy bài kiểm tra để chỉnh sửa với ID:", id);
            return;
        }
        const test = testDocSnap.data();
        console.log("Đang tải bài kiểm tra để chỉnh sửa:", test);
        document.getElementById('test-title').value = test.title || '';
        document.getElementById('test-timer').value = test.timer || 0;
        await loadTestFolderOptions(test.folderId || '');
        await loadAssignmentOptions(test);

        const startTimeInput = document.getElementById('start-time');
        const endTimeInput = document.getElementById('end-time');

        if (test.startTime && startTimeInput) {
            const startDate = test.startTime.toDate();
            // Định dạng ngày thành chuỗi YYYY-MM-DDTHH:mm
            const formattedDate = startDate.toISOString().slice(0, 16);
            startTimeInput.value = formattedDate;
        }
        
        if (test.endTime && endTimeInput) {
            const endDate = test.endTime.toDate();
            const formattedDate = endDate.toISOString().slice(0, 16);
            endTimeInput.value = formattedDate;
        }

        initializeCreateParts(test);
        updateCompleteButtonState();
    } catch (e) {
        console.error("Lỗi khi tải bài kiểm tra từ Firestore:", e);
    }
}

let examLoadedTest = null;

function getAnswerKey(partIndex, questionIndex, itemKey) {
    return `part-${partIndex}-q-${questionIndex}-${itemKey}`;
}

function captureExamPartAnswers() {
    if (!examParts) return;
    document.querySelectorAll('[data-answer-key]').forEach(input => {
        const key = input.dataset.answerKey;
        if (!key) return;
        if (input.type === 'checkbox') {
            if (!Array.isArray(examAnswerState[key])) {
                examAnswerState[key] = [];
            }
            const value = Number(input.value);
            examAnswerState[key] = examAnswerState[key].filter(existing => existing !== value);
            if (input.checked) {
                examAnswerState[key].push(value);
                examAnswerState[key].sort((a, b) => a - b);
            }
        } else if (input.type === 'radio') {
            if (input.checked) {
                examAnswerState[key] = Number(input.value);
            } else if (!(key in examAnswerState)) {
                examAnswerState[key] = null;
            }
        } else {
            examAnswerState[key] = input.value;
        }
    });
}

function restoreExamPartAnswers() {
    document.querySelectorAll('[data-answer-key]').forEach(input => {
        const key = input.dataset.answerKey;
        if (!key || !(key in examAnswerState)) return;
        const savedValue = examAnswerState[key];
        if (input.type === 'checkbox') {
            input.checked = Array.isArray(savedValue) && savedValue.includes(Number(input.value));
        } else if (input.type === 'radio') {
            input.checked = savedValue === Number(input.value);
        } else {
            input.value = savedValue || '';
        }
    });
}

function getExamQuestionNavItems(part, partIndex) {
    const items = [];
    (part?.questions || []).forEach((question, qIndex) => {
        if (question?.type === 'multipleChoiceSection') {
            if (question.sectionMode === 'selectionSet') {
                const count = Array.isArray(question.correctAnswers) ? question.correctAnswers.length : 0;
                const numbers = getQuestionNumbersFromRangeTitle(question.title, count);
                const key = getAnswerKey(partIndex, qIndex, 'selection-set');
                numbers.forEach((number, index) => {
                    items.push({ number, anchor: key, key, selectionIndex: index });
                });
                return;
            }

            (question.items || []).forEach((item, itemIndex) => {
                const key = getAnswerKey(partIndex, qIndex, `item-${itemIndex}`);
                items.push({ number: item.number || String(items.length + 1), anchor: key, key });
            });
            return;
        }

        if (question?.type === 'inlineBlankSection') {
            (question.blanks || []).forEach(blank => {
                const key = getAnswerKey(partIndex, qIndex, `blank-${blank.number}`);
                items.push({ number: blank.number, anchor: key, key });
            });
            return;
        }

        if (question?.type === 'dropdownSection') {
            (question.rows || []).forEach(row => {
                const key = getAnswerKey(partIndex, qIndex, `dropdown-${row.number || ''}`);
                items.push({ number: row.number || String(items.length + 1), anchor: key, key });
            });
            return;
        }

        const key = getAnswerKey(partIndex, qIndex, 'legacy');
        items.push({ number: String(qIndex + 1), anchor: key, key });
    });
    return items;
}

function isExamAnswerComplete(item) {
    const value = examAnswerState[item.key];
    if (typeof item.selectionIndex === 'number') {
        return Array.isArray(value) && value.length > item.selectionIndex;
    }
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'number') return true;
    return String(value || '').trim().length > 0;
}

function getExamPartProgress(part, partIndex) {
    const items = getExamQuestionNavItems(part, partIndex);
    return {
        answered: items.filter(isExamAnswerComplete).length,
        total: items.length,
        items
    };
}

function renderExamPartNav() {
    const nav = document.getElementById('exam-part-nav');
    if (!nav || !examParts) return;
    nav.innerHTML = examParts.map((part, index) => {
        const progress = getExamPartProgress(part, index);
        const isExpanded = expandedExamPartIndex === index;
        const dots = isExpanded && progress.items.length > 0
            ? `<div class="exam-part-question-map">
                ${progress.items.map(item => `
                    <button type="button"
                        class="exam-question-dot ${isExamAnswerComplete(item) ? 'answered' : ''}"
                        onclick="event.stopPropagation(); window.jumpToExamQuestion(${index}, ${escapeHtml(JSON.stringify(item.anchor))})">
                        ${escapeHtml(item.number)}
                    </button>
                `).join('')}
            </div>`
            : '';
        return `
            <div class="part-tab exam-part-tab ${index === activeExamPartIndex ? 'active' : ''} ${isExpanded ? 'expanded' : ''}" onclick="window.toggleExamPartNav(${index})">
                <button type="button" class="exam-part-toggle">
                    <span class="exam-part-summary">Part ${index + 1}${isExpanded ? '' : `: <small>${progress.answered} of ${progress.total} question${progress.total === 1 ? '' : 's'}</small>`}</span>
                </button>
                ${dots}
            </div>
        `;
    }).join('');
}

function renderExamQuestion(q, qIndex, partIndex) {
    const div = document.createElement('div');
    div.className = q.type === 'inlineBlankSection'
        ? 'question inline-blank-section'
        : q.type === 'dropdownSection'
            ? 'question dropdown-section'
            : q.type === 'multipleChoiceSection'
                ? 'question multiple-choice-section'
                : 'question';
    div.dataset.type = q.type || '';
    div.dataset.partIndex = String(partIndex);
    div.dataset.questionIndex = String(qIndex);
    let questionHtml = '';

    if (q.type === 'multipleChoiceSection') {
        if (q.sectionMode === 'selectionSet') {
            const options = Array.isArray(q.options) ? q.options : [];
            const correctCount = Array.isArray(q.correctAnswers) ? q.correctAnswers.length : 0;
            const key = getAnswerKey(partIndex, qIndex, 'selection-set');
            questionHtml = `
                <h2 class="inline-section-title-display">${escapeHtml(q.title || `Questions`)}</h2>
                ${q.instruction ? `<div class="inline-section-instruction-display">${richTextForDisplay(q.instruction)}</div>` : ''}
                <div class="mcq-selection-display" data-correct-count="${correctCount}">
                    ${options.map((option, optionIndex) => {
                        const letter = String.fromCharCode(65 + optionIndex);
                        return `
                            <label class="mcq-selection-answer-row">
                                <span class="mcq-letter-badge">${letter}</span>
                                <input class="mcq-answer-input mcq-selection-input" type="checkbox" name="${key}" value="${optionIndex}" data-answer-key="${key}">
                                <span class="mcq-choice-text">${escapeHtml(option)}</span>
                            </label>
                        `;
                    }).join('')}
                </div>
            `;
            div.innerHTML = questionHtml;
            return div;
        }

        const items = Array.isArray(q.items) ? q.items : [];
        questionHtml = `
            <h2 class="inline-section-title-display">${escapeHtml(q.title || `Questions`)}</h2>
            ${q.instruction ? `<div class="inline-section-instruction-display">${richTextForDisplay(q.instruction)}</div>` : ''}
            <div class="mcq-section-display">
                ${items.map((item, itemIndex) => {
                    const inputType = item.mcqType === 'multiple' ? 'checkbox' : 'radio';
                    const key = getAnswerKey(partIndex, qIndex, `item-${itemIndex}`);
                    return `
                        <div class="mcq-section-item" data-item-index="${itemIndex}">
                            <p class="mcq-section-prompt"><strong>${escapeHtml(item.number || '')}.</strong> ${escapeHtml(item.prompt || '')}</p>
                            <div class="mcq-answer-list ${item.mcqType === 'multiple' ? 'multiple' : 'single'}">
                                ${(item.choices || []).map((choice, choiceIndex) => {
                                    const letter = String.fromCharCode(65 + choiceIndex);
                                    return `
                                        <label class="mcq-answer-row">
                                            <span class="mcq-letter-badge">${letter}</span>
                                            <input class="mcq-answer-input" type="${inputType}" name="${key}" value="${choiceIndex}" data-answer-key="${key}">
                                            <span class="mcq-choice-text">${escapeHtml(choice)}</span>
                                        </label>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        div.innerHTML = questionHtml;
        return div;
    }

    if (q.type === 'inlineBlankSection') {
        questionHtml = `
            <h2 class="inline-section-title-display">${escapeHtml(q.title || `Questions`)}</h2>
            ${q.instruction ? `<div class="inline-section-instruction-display">${richTextForDisplay(q.instruction)}</div>` : ''}
            <div class="inline-section-content-display">${renderInlineBlankContent(q.content || '', `${partIndex}-${qIndex}`)}</div>
        `;
        div.innerHTML = questionHtml;
        div.querySelectorAll('.inline-blank-answer').forEach(input => {
            input.dataset.answerKey = getAnswerKey(partIndex, qIndex, `blank-${input.dataset.blankNumber}`);
        });
        return div;
    }

    if (q.type === 'dropdownSection') {
        const options = Array.isArray(q.options) ? q.options : [];
        const rows = Array.isArray(q.rows) ? q.rows : [];
        const dropdownWidth = getDropdownWidthCh(options);
        questionHtml = `
            <h2 class="inline-section-title-display">${escapeHtml(q.title || `Questions`)}</h2>
            ${q.instruction ? `<div class="inline-section-instruction-display">${richTextForDisplay(q.instruction)}</div>` : ''}
            <div class="dropdown-section-display">
                ${rows.map(row => {
                    const safeNumber = escapeHtml(row.number || '');
                    const key = getAnswerKey(partIndex, qIndex, `dropdown-${row.number || ''}`);
                    return `
                        <div class="dropdown-question-row">
                            <span class="dropdown-question-number">${safeNumber}.</span>
                            <select class="dropdown-answer-select" style="--dropdown-width: ${dropdownWidth}ch;" data-question-number="${safeNumber}" data-answer-key="${key}">
                                <option value=""></option>
                                ${options.map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}
                            </select>
                            <span class="dropdown-question-prompt">${escapeHtml(row.prompt || '')}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        div.innerHTML = questionHtml;
        return div;
    }

    const legacyKey = getAnswerKey(partIndex, qIndex, 'legacy');
    questionHtml = `<p>${qIndex + 1}. ${richTextForDisplay(q.qText)}</p>`;
    if (q.type === 'mcq') {
        const inputType = q.mcqType === 'single' ? 'radio' : 'checkbox';
        questionHtml += `
            <div class="mcq-answer-list ${q.mcqType === 'multiple' ? 'multiple' : 'single'}">
                ${(q.choices || []).map((c, j) => {
                    const letter = String.fromCharCode(65 + j);
                    return `
                        <label class="mcq-answer-row">
                            <span class="mcq-letter-badge">${letter}</span>
                            <input class="mcq-answer-input" type="${inputType}" name="${legacyKey}" value="${j}" data-answer-key="${legacyKey}">
                            <span class="mcq-choice-text">${escapeHtml(c)}</span>
                        </label>
                    `;
                }).join('')}
            </div>
        `;
    } else {
        questionHtml += `<input class="short-answer" name="${legacyKey}" data-answer-key="${legacyKey}" />`;
    }
    div.innerHTML = questionHtml;
    return div;
}

function renderExamPart(index, expandNav = false) {
    if (!examParts) return;
    const examInstructionsContainer = document.getElementById('exam-instructions');
    const container = document.getElementById('exam-questions');
    if (!examInstructionsContainer || !container) return;

    activeExamPartIndex = index;
    expandedExamPartIndex = expandNav ? index : null;
    const part = examParts[index] || createEmptyPart(index + 1);
    examInstructionsContainer.innerHTML = richTextForDisplay(part.instructions || '');
    container.innerHTML = '';
    (part.questions || []).forEach((q, qIndex) => {
        container.appendChild(renderExamQuestion(q, qIndex, index));
    });
    restoreExamPartAnswers();
    renderExamPartNav();
}

function switchExamPart(index) {
    if (!examParts || index === activeExamPartIndex) {
        renderExamPartNav();
        return;
    }
    captureExamPartAnswers();
    renderExamPart(index);
}

function toggleExamPartNav(index) {
    if (!examParts) return;
    if (index !== activeExamPartIndex) {
        captureExamPartAnswers();
        renderExamPart(index, true);
        return;
    }
    expandedExamPartIndex = expandedExamPartIndex === index ? null : index;
    renderExamPartNav();
}

function jumpToExamQuestion(partIndex, answerKey) {
    if (!examParts) return;
    const scrollToAnswer = () => {
        const target = [...document.querySelectorAll('[data-answer-key]')]
            .find(input => input.dataset.answerKey === answerKey);
        if (!target) return;
        const section = target.closest('.question') || target;
        section.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.focus?.({ preventScroll: true });
    };

    if (partIndex !== activeExamPartIndex) {
        captureExamPartAnswers();
        renderExamPart(partIndex, true);
        requestAnimationFrame(scrollToAnswer);
        return;
    }
    scrollToAnswer();
}

function handleExamAnswerChange() {
    captureExamPartAnswers();
    renderExamPartNav();
}

function getIeltsExamSubmissionData() {
    captureExamPartAnswers();
    return {
        test: examLoadedTest,
        parts: examParts,
        answers: examAnswerState
    };
}

window.switchCreatePart = switchCreatePart;
window.switchExamPart = switchExamPart;
window.toggleExamPartNav = toggleExamPartNav;
window.jumpToExamQuestion = jumpToExamQuestion;
window.getIeltsExamSubmissionData = getIeltsExamSubmissionData;
window.getQuestionPointCount = getQuestionPointCount;
window.getAnswerKey = getAnswerKey;

    async function loadTestToDo() {
        const urlParams = new URLSearchParams(window.location.search);
        const testId = urlParams.get('testId');
        if (!testId) {
            console.error("Không tìm thấy ID bài kiểm tra trong URL.");
            alert("Error: Could not find a test to take. Please return to the class page.");
            return;
        }
        try {
            const classCode = urlParams.get('classCode'); 
            if (!testId || !classCode) {
                console.error("Không tìm thấy ID bài kiểm tra hoặc mã lớp trong URL.");
                alert("Error: Could not find a test or class code in the URL.");
                return;
            }
            const testDocRef = doc(db, "classes", classCode, "tests", testId);
            const testDocSnap = await getDoc(testDocRef);
            if (!testDocSnap.exists()) {
                console.error("Không tìm thấy bài kiểm tra với ID:", testId);
                alert("Error: Could not find this test.");
                return;
            }
            const test = testDocSnap.data();
            const userId = getCurrentUserUid();
            const userRole = await getCurrentUserClassRole(classCode, userId);
            if (!isTestAssignedToUser(test, userId, userRole)) {
                alert("This test has not been assigned to you.");
                window.location.href = `class.html?classCode=${classCode}&tab=classwork`;
                return;
            }
            examLoadedTest = test;
            examParts = normalizeTestParts(test);
            examAnswerState = {};
            renderExamPart(0, true);
        } catch (e) {
            console.error("Lỗi khi tải bài kiểm tra để làm:", e);
            alert("Error: Could not load the test. Please try again.");
        }
    }
    window.loadTestToDo = loadTestToDo;


    async function getUserRole(userId) {
        try {
            const userDocRef = doc(db, "users", userId);
            const userDocSnap = await getDoc(userDocRef);
            if (userDocSnap.exists()) {
                return userDocSnap.data().role;
            }
        } catch (e) {
            console.error("Lỗi khi lấy vai trò người dùng:", e);
        }
        return null;
    }

    async function loadGradesForClass() {
        const gradesList = document.getElementById('grades-list');
        const noGradesContent = document.getElementById('noGradesContent');
        if (!gradesList) {
            console.error("Element with ID 'grades-list' not found. Cannot load grades.");
            return;
        }
        const urlParams = new URLSearchParams(window.location.search);
        const currentClassCode = urlParams.get('classCode');
        const userId = getCurrentUserUid();

        if (!currentClassCode) {
            gradesList.innerHTML = '<p>No class selected. Please go to a class page.</p>';
            return;
        }

        try {
            // Lấy vai trò của người dùng
            const userRole = await getUserRole(userId);
            cachedGradeRole = userRole;
            cachedGradeClassCode = currentClassCode;
            restoreOpenGradeStudentFoldersForReturn(currentClassCode);
            const gradesSearchInput = document.getElementById('gradesSearchInput');
            if (gradesSearchInput) {
                gradesSearchInput.placeholder = userRole === 'teacher' ? 'Search students or tests' : 'Search tests';
            }
            let q;

            // Xây dựng truy vấn dựa trên vai trò
            if (userRole === 'teacher') {
                console.log("Là giáo viên, tải tất cả điểm số trong lớp.");
                q = query(collection(db, "testResults"), where("classCode", "==", currentClassCode));
            } else { // Mặc định là học sinh hoặc vai trò khác
                console.log("Là học sinh, chỉ tải điểm số của bản thân.");
                q = query(collection(db, "testResults"),
                        where("classCode", "==", currentClassCode),
                        where("userId", "==", userId));
            }

            const querySnapshot = await getDocs(q);
            const resultsForCurrentClass = [];
            querySnapshot.forEach((doc) => {
                const result = { resultId: doc.id, ...doc.data() };
                if (!result.deleted) {
                    resultsForCurrentClass.push(result);
                }
            });

            console.log("Số lượng kết quả lấy được:", resultsForCurrentClass.length);

            if (resultsForCurrentClass.length === 0) {
                gradesList.classList.add('hidden');
                noGradesContent.classList.remove('hidden');
                console.log("Không có kết quả nào cho classCode:", currentClassCode);
            } else {
                gradesList.classList.remove('hidden');
                noGradesContent.classList.add('hidden');
            }

            resultsForCurrentClass.sort((a, b) => {
                const aTime = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp);
                const bTime = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp);
                return bTime - aTime;
            });

            cachedGradeResults = resultsForCurrentClass;
            if (userRole === 'teacher') {
                cachedGradeStudentInfo = await loadGradeStudentInfo(resultsForCurrentClass);
            } else {
                cachedGradeStudentInfo = {};
            }
            renderCachedGrades();
        } catch (e) {
            console.error("Error loading grades from Firestore:", e);
            gradesList.innerHTML = '<p>Error loading grades. Please try again.</p>';
        }
    }
    window.loadGradesForClass = loadGradesForClass;

    async function loadGradeStudentInfo(results) {
        const studentInfo = {};
        for (const result of results) {
            if (!studentInfo[result.userId]) {
                const studentDoc = await getDoc(doc(db, "users", result.userId));
                const studentData = studentDoc.exists() ? studentDoc.data() : { firstname: "Unknown", lastname: "" };
                studentInfo[result.userId] = {
                    name: `${studentData.firstname || 'Unknown'} ${studentData.lastname || ''}`.trim(),
                    email: studentData.email || ''
                };
            }
        }
        return studentInfo;
    }

    function renderCachedGrades() {
        const gradesList = document.getElementById('grades-list');
        const noGradesContent = document.getElementById('noGradesContent');
        if (!gradesList) return;

        gradesList.innerHTML = '';
        const searchTerm = (document.getElementById('gradesSearchInput')?.value || '').trim().toLowerCase();

        if (cachedGradeResults.length === 0) {
            gradesList.classList.add('hidden');
            noGradesContent?.classList.remove('hidden');
            return;
        }

        gradesList.classList.remove('hidden');
        noGradesContent?.classList.add('hidden');

        if (cachedGradeRole === 'teacher') {
            renderTeacherGrades(cachedGradeResults, cachedGradeClassCode, searchTerm, gradesList);
        } else {
            renderStudentGrades(cachedGradeResults, cachedGradeClassCode, searchTerm, gradesList);
        }

        if (gradesList.children.length === 0) {
            gradesList.innerHTML = '<p class="empty-search-message">No grades match your search.</p>';
        }
    }

    function renderTeacherGrades(results, classCode, searchTerm, gradesList) {
        const groups = new Map();

        for (const result of results) {
            if (!groups.has(result.userId)) {
                groups.set(result.userId, []);
            }
            groups.get(result.userId).push(result);
        }

        [...groups.entries()]
            .sort((a, b) => cachedGradeStudentInfo[a[0]].name.localeCompare(cachedGradeStudentInfo[b[0]].name))
            .forEach(([studentId, studentResults]) => {
                const studentInfo = cachedGradeStudentInfo[studentId] || { name: 'Unknown', email: '' };
                const studentMatches = !searchTerm ||
                    studentInfo.name.toLowerCase().includes(searchTerm) ||
                    studentInfo.email.toLowerCase().includes(searchTerm);
                const filteredResults = studentResults.filter(result => {
                    if (!searchTerm || studentMatches) return true;
                    return (result.testTitle || '').toLowerCase().includes(searchTerm);
                });

                if (filteredResults.length === 0) return;

                const folder = document.createElement('section');
                folder.className = 'grade-student-folder';
                folder.dataset.studentId = studentId;
                folder.innerHTML = `
                    <div class="grade-student-header">
                        <button type="button" class="folder-toggle">▾</button>
                        <h3>${studentInfo.name}</h3>
                        <span>${filteredResults.length} score${filteredResults.length === 1 ? '' : 's'}</span>
                        <button type="button" class="folder-delete-btn grade-folder-delete-btn">Delete</button>
                    </div>
                    <div class="grade-student-body"></div>
                `;
                const body = folder.querySelector('.grade-student-body');
                const toggleButton = folder.querySelector('.folder-toggle');
                const deleteButton = folder.querySelector('.grade-folder-delete-btn');
                const shouldOpen = Boolean(searchTerm) || openGradeStudentIds.has(studentId);
                if (!shouldOpen) {
                    body.classList.add('hidden');
                    toggleButton.textContent = '▸';
                }
                toggleButton.addEventListener('click', (event) => {
                    body.classList.toggle('hidden');
                    event.currentTarget.textContent = body.classList.contains('hidden') ? '▸' : '▾';
                    if (body.classList.contains('hidden')) {
                        openGradeStudentIds.delete(studentId);
                    } else {
                        openGradeStudentIds.add(studentId);
                    }
                });
                deleteButton?.addEventListener('click', (event) => deleteGradeStudentFolder(studentId, studentInfo.name, studentResults, event.currentTarget));

                filteredResults.forEach(result => body.appendChild(buildGradeItem(result, classCode, true)));
                gradesList.appendChild(folder);
            });
    }

    function renderStudentGrades(results, classCode, searchTerm, gradesList) {
        results
            .filter(result => !searchTerm || (result.testTitle || '').toLowerCase().includes(searchTerm))
            .forEach(result => gradesList.appendChild(buildGradeItem(result, classCode, false)));
    }

    function buildGradeItem(result, classCode, isTeacher) {
        const div = document.createElement('div');
        div.className = 'test-item grade-item';
        const submittedDate = result.timestamp?.toDate ? result.timestamp.toDate() : new Date(result.timestamp);
        div.innerHTML = `
            <div class="grade-card-info">
                <h3 class="grade-card-title">${result.testTitle}</h3>
                <div class="grade-summary">
                    <span class="grade-score-label">Score:</span>
                    <span class="score">${result.score}</span>
                    <span class="grade-score-divider">/</span>
                    <span class="total">${result.totalQuestions}</span>
                </div>
                <p class="grade-submitted-at text-base text-gray-500">${Number.isNaN(submittedDate.getTime()) ? 'N/A' : submittedDate.toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}</p>
            </div>
            <div class="test-actions">
                <button onclick="window.viewScore('${result.resultId}', '${classCode}')">Score</button>
                ${isTeacher ? `<button class="delete-btn" onclick="window.deleteScoreFromGrades('${result.resultId}')">Delete</button>` : ''}
            </div>`;
        return div;
    }

    async function deleteScoreFromGrades(resultId) {
        return window.withButtonLock(null, async () => {
        if (!await window.appConfirm("Delete this score?", { title: 'Delete score' })) return;
        const userId = getCurrentUserUid();
        try {
            captureOpenGradeStudentFolders();
            await updateDoc(doc(db, "testResults", resultId), {
                deleted: true,
                deletedAt: new Date(),
                deletedBy: userId
            });
            cachedGradeResults = cachedGradeResults.filter(result => result.resultId !== resultId);
            renderCachedGrades();
        } catch (error) {
            console.error("Error deleting score:", error);
            alert("Failed to delete score: " + error.message);
        }
        });
    }
    window.deleteScoreFromGrades = deleteScoreFromGrades;

    async function deleteGradeStudentFolder(studentId, studentName, results, button = null) {
        return window.withButtonLock(button, async () => {
            const scoreCount = Array.isArray(results) ? results.length : 0;
            const scoreLabel = `${scoreCount} score${scoreCount === 1 ? '' : 's'}`;
            const confirmed = await window.appConfirm(
                `Delete grade folder "${studentName}"? All ${scoreLabel} inside will be permanently deleted and cannot be restored.`,
                { title: 'Delete grade folder' }
            );
            if (!confirmed) return;

            const userId = getCurrentUserUid();
            try {
                captureOpenGradeStudentFolders();
                await Promise.all((results || []).map(result => updateDoc(doc(db, "testResults", result.resultId), {
                    deleted: true,
                    deletedAt: new Date(),
                    deletedBy: userId
                })));
                cachedGradeResults = cachedGradeResults.filter(result => result.userId !== studentId);
                openGradeStudentIds.delete(studentId);
                renderCachedGrades();
            } catch (error) {
                console.error("Error deleting grade folder:", error);
                await window.appAlert("Failed to delete grade folder: " + error.message, { title: 'Delete failed' });
            }
        });
    }
    window.deleteGradeStudentFolder = deleteGradeStudentFolder;
    window.renderCachedGrades = renderCachedGrades;

    function viewScore(resultId, classCode) {
        saveOpenGradeStudentFoldersForReturn(classCode);
        window.location.href = `score.html?resultId=${resultId}&classCode=${classCode}`;
    }
    window.viewScore = viewScore;

    // --- END: FIREBASE DATA MANAGEMENT FUNCTIONS ---


// --- START: GLOBAL EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
    const currentPage = window.location.pathname.split('/').pop();

    document.addEventListener('selectionchange', saveRichTextSelection);
    document.addEventListener('focusin', (event) => {
        if (event.target.matches('[contenteditable="true"]')) {
            activeRichTextEditor = event.target;
            saveRichTextSelection();
        }
    });
    document.addEventListener('keyup', (event) => {
        if (event.target.matches('[contenteditable="true"]')) {
            saveRichTextSelection();
        }
    });
    document.addEventListener('mousedown', (event) => {
        const editor = event.target.closest?.('[contenteditable="true"]');
        if (editor && !event.target.closest('.rich-text-toolbar')) {
            activeRichTextEditor = editor;
            richEditorPointerDown = { editor, x: event.clientX, y: event.clientY };
        }
    }, true);
    document.addEventListener('mouseup', (event) => {
        const editor = event.target.closest?.('[contenteditable="true"]');
        if (!editor) return;
        const start = richEditorPointerDown;
        richEditorPointerDown = null;
        const isSimpleClick = start &&
            start.editor === editor &&
            Math.abs(event.clientX - start.x) < 4 &&
            Math.abs(event.clientY - start.y) < 4;

        if (isSimpleClick) {
            placeCaretInEditorFromPoint(editor, event.clientX, event.clientY);
            return;
        }

        saveRichTextSelection();
    });
    document.addEventListener('mousedown', (event) => {
        if (event.target.closest('.rich-tool-button')) {
            event.preventDefault();
            event.stopPropagation();
        }
    });
    document.addEventListener('click', (event) => {
        const button = event.target.closest('.rich-tool-button');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        applyRichTextCommand(button.dataset.command, button.dataset.value || null);
    });
    document.addEventListener('change', (event) => {
        if (event.target.matches('.rich-tool-select, .rich-tool-color-input')) {
            if (event.target.matches('.rich-tool-color-input')) {
                syncRichColorInput(event.target);
            }
            applyRichTextCommand(event.target.dataset.command, event.target.value);
            if (event.target.matches('.rich-tool-select')) {
                event.target.value = '';
            }
        }
    });
    document.querySelectorAll('.rich-tool-color-input').forEach(syncRichColorInput);

    onAuthStateChanged(auth, (user) => {
        if (user && !hasPageLoaded) {
            hasPageLoaded = true;
            console.log("User is logged in:", user.uid);
            if (currentPage === 'create.html') {
                const urlParams = new URLSearchParams(window.location.search);
                const testId = urlParams.get('testId');
                if (!testId) {
                    loadTestFolderOptions();
                    loadAssignmentOptions();
                    initializeCreateParts();
                } else {
                    loadEditTestIfAny();
                }
            } else if (currentPage === 'exam.html') {
                window.loadTestToDo();
            }
        } else if (!user) {
            console.log("User is logged out.");
        }
    });

    const questionsContainer = document.getElementById('questions');
    if (questionsContainer) {
        questionsContainer.addEventListener('input', (event) => {
            if (event.target.classList.contains('mcq-option-text') ||
                event.target.classList.contains('q-text') ||
                event.target.classList.contains('text-answer') ||
                event.target.classList.contains('inline-section-title') ||
                event.target.classList.contains('inline-section-instruction') ||
                event.target.classList.contains('inline-section-content') ||
                event.target.classList.contains('dropdown-section-title') ||
                event.target.classList.contains('dropdown-section-instruction') ||
                event.target.classList.contains('dropdown-section-options') ||
                event.target.classList.contains('dropdown-row-number') ||
                event.target.classList.contains('dropdown-row-prompt') ||
                event.target.classList.contains('mcq-section-title') ||
                event.target.classList.contains('mcq-section-instruction') ||
                event.target.classList.contains('mcq-section-item-number') ||
                event.target.classList.contains('mcq-section-item-prompt') ||
                event.target.classList.contains('mcq-section-option-text') ||
                event.target.classList.contains('mcq-selection-option-text')) {
                updateCompleteButtonState();
            }
        });
        questionsContainer.addEventListener('change', (event) => {
            if (event.target.classList.contains('mcq-option-input') ||
                event.target.classList.contains('q-type') ||
                event.target.classList.contains('dropdown-row-answer') ||
                event.target.classList.contains('mcq-section-correct-input') ||
                event.target.classList.contains('mcq-selection-correct-input') ||
                event.target.classList.contains('mcq-section-mode') ||
                event.target.classList.contains('mcq-section-choice-type')) {
                updateCompleteButtonState();
            }
        });
    }

    const examQuestionsContainer = document.getElementById('exam-questions');
    if (examQuestionsContainer) {
        examQuestionsContainer.addEventListener('input', (event) => {
            if (event.target.matches('[data-answer-key]')) {
                handleExamAnswerChange();
            }
        });
        examQuestionsContainer.addEventListener('change', (event) => {
            if (event.target.matches('[data-answer-key]')) {
                handleExamAnswerChange();
            }
        });
    }

    const testTitleInput = document.getElementById('test-title');
    if (testTitleInput) {
        testTitleInput.addEventListener('input', updateCompleteButtonState);
    }
    const folderSelect = document.getElementById('test-folder-select');
    if (folderSelect) {
        folderSelect.addEventListener('change', updateCompleteButtonState);
    }
    const testTimerInput = document.getElementById('test-timer');
    if (testTimerInput) {
        testTimerInput.addEventListener('input', updateCompleteButtonState);
    }
    const gradesSearchInput = document.getElementById('gradesSearchInput');
    if (gradesSearchInput) {
        gradesSearchInput.addEventListener('input', () => {
            if (typeof window.renderCachedGrades === 'function') {
                window.renderCachedGrades();
            }
        });
    }

    const closeButtonNav = document.getElementById('close-button');
    const urlParams = new URLSearchParams(window.location.search);
    const classCode = urlParams.get('classCode');
    if (closeButtonNav) {
        closeButtonNav.addEventListener('click', () => {
            if (classCode) {
                window.location.href = `class.html?classCode=${classCode}&tab=classwork`;
            } else {
                alert("Class code not found. Returning to dashboard.");
                window.location.href = 'dashboard.html';
            }
        });
    } else {
        console.warn("Close button with ID 'close-button' not found.");
    }
    const svgHamburgerBtn = document.getElementById('svg-hamburger-btn');
const hamburgerMenu = document.getElementById('hamburger-menu');
const exitTestBtn = document.getElementById('exit-test-btn');

if (svgHamburgerBtn && hamburgerMenu) {
    svgHamburgerBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        hamburgerMenu.classList.toggle('hidden');
        svgHamburgerBtn.classList.toggle('open');
    });

    document.addEventListener('click', (event) => {
        if (hamburgerMenu.classList.contains('hidden')) {
            return;
        }
        if (!svgHamburgerBtn.contains(event.target) && !hamburgerMenu.contains(event.target)) {
            hamburgerMenu.classList.add('hidden');
            svgHamburgerBtn.classList.remove('open');
        }
    });

    if (exitTestBtn) {
        exitTestBtn.addEventListener('click', () => {
            hamburgerMenu.classList.add('hidden');
            svgHamburgerBtn.classList.remove('open');
        });
    }
} else {
    console.warn("Cảnh báo: Không tìm thấy Nút Hamburger SVG (ID 'svg-hamburger-btn') hoặc Menu Hamburger (ID 'hamburger-menu'). Chức năng này sẽ không hoạt động.");
}

const exitConfirmModal = document.getElementById('exitConfirmModal');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const modalYesBtn = document.getElementById('modalYesBtn');
const closeButtonModal = exitConfirmModal ? exitConfirmModal.querySelector('.close-button') : null; 


if (exitTestBtn && exitConfirmModal && modalCancelBtn && modalYesBtn) {
    exitTestBtn.addEventListener('click', () => {
        exitConfirmModal.classList.add('visible');
        const svgHamburgerBtn = document.getElementById('svg-hamburger-btn');
        const hamburgerMenu = document.getElementById('hamburger-menu');
        if (svgHamburgerBtn && hamburgerMenu) {
            hamburgerMenu.classList.add('hidden');
            svgHamburgerBtn.classList.remove('open');
        }
    });

    modalCancelBtn.addEventListener('click', () => {
        exitConfirmModal.classList.remove('visible');
    });

    modalYesBtn.addEventListener('click', () => {
        if (classCode) {
            window.location.href = `class.html?classCode=${classCode}&tab=classwork`; 
        } else {
            alert('Class Code not found. Returning to dashboard.');
            window.location.href = 'dashboard.html'; 
        }
        exitConfirmModal.classList.remove('visible');
    });

    if (closeButtonModal) { 
        closeButtonModal.addEventListener('click', () => {
            exitConfirmModal.classList.remove('visible'); 
        });
    }

    exitConfirmModal.addEventListener('click', (event) => {
        if (event.target === exitConfirmModal) {
            exitConfirmModal.classList.remove('visible');
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && exitConfirmModal.classList.contains('visible')) {
            exitConfirmModal.classList.remove('visible');
        }
    });

} else {
    console.warn("Cảnh báo: Không tìm thấy các phần tử Modal Confirmation. Chức năng thoát sẽ không hoạt động đúng.");
}


});
// --- END: GLOBAL EVENT LISTENERS ---
