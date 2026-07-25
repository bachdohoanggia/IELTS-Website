import { db } from "./firebase.js";
import {
    doc,
    addDoc,
    updateDoc, 
    query,
    collection,
    where,
    getDocs,
    deleteDoc,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

function getPathToNode(node, root) {
    if (!node || !root || !root.contains(node)) {
        return null;
    }
    const path = [];
    let currentNode = node;
    while (currentNode && currentNode !== root) {
        let index = 0;
        let sibling = currentNode.previousSibling;
        while (sibling) {
            index++;
            sibling = sibling.previousSibling;
        }
        path.unshift(index);
        currentNode = currentNode.parentNode;
    }
    return path;
}

function getNodeFromPath(path, root) {
    if (!path || !root) {
        return null;
    }
    let currentNode = root;
    for (let i = 0; i < path.length; i++) {
        const index = path[i];
        if (!currentNode.childNodes[index]) {
            console.warn("getNodeFromPath: Invalid path segment or node missing at index", index, "in", currentNode);
            return null;
        }
        currentNode = currentNode.childNodes[index];
    }
    return currentNode;
}

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



document.addEventListener('DOMContentLoaded', () => {
    const notepadToggleBtn = document.getElementById('notepad-toggle-btn');
    const notepadSidebar = document.getElementById('notepad-sidebar');
    const notepadCloseBtn = document.getElementById('notepad-close-btn');
    const notesList = document.getElementById('notes-list');
    const notepadSearchInput = document.getElementById('notepad-search-input');

    const noteInputModal = document.getElementById('note-input-modal');
    const modalNewNoteTextarea = document.getElementById('modal-new-note-textarea');
    const modalSaveNoteBtn = document.getElementById('modal-save-note-btn');
    const modalCancelNoteBtn = document.getElementById('modal-cancel-note-btn');

    let editingNoteId = null;
    let currentHighlightedText = '';
    let currentSelectionRangeForNote = null;

    // --- FIREBASE INTEGRATION START ---
    function getCurrentTestId() {
        const urlParams = new URLSearchParams(window.location.search);
        const testId = urlParams.get('testId') || localStorage.getItem('currentTest');
        if (!testId) {
            console.warn("Notepad: No 'currentTest' ID found. This may prevent notes from being linked correctly.");
        }
        return testId || 'defaultTestId';
    }

    // Hàm lấy ghi chú từ Firestore
    async function loadNotes() {
        const testId = getCurrentTestId();
        const notes = {};
        if (!testId) {
            return notes;
        }
        try {
            const notesCollection = collection(db, "notes");
            const q = query(notesCollection, where("testId", "==", testId));
            const querySnapshot = await getDocs(q);

            querySnapshot.forEach((doc) => {
                notes[doc.id] = { id: doc.id, ...doc.data() };
            });
            console.log("Notes loaded from Firestore:", notes);
        } catch (e) {
            console.error("Notepad: Error loading notes from Firestore:", e);
        }
        return notes;
    }

    async function saveNote(noteData, noteId = null) {
        const testId = getCurrentTestId();
        if (!testId) {
            console.error("Notepad: Cannot save note: No current test ID found.");
            return;
        }
        noteData.testId = testId; 

        try {
            if (noteId) {
                const noteRef = doc(db, "notes", noteId);
                await updateDoc(noteRef, noteData);
                console.log("Document updated with ID:", noteId);
                return noteId;
            } else {
                const notesCollection = collection(db, "notes");
                const docRef = await addDoc(notesCollection, noteData);
                console.log("Document written with ID:", docRef.id);
                return docRef.id;
            }
        } catch (e) {
            console.error("Notepad: Error adding/updating document:", e);
            return null;
        }
    }

    window.deleteNote = async function(id) {
        return window.withButtonLock(null, async () => {
        try {
            const noteRef = doc(db, "notes", id);
            await deleteDoc(noteRef);
            console.log("Document successfully deleted!");
            displayNotes();
            applyNotedHighlights();
            if (editingNoteId === id) {
                toggleNoteInputModal(false);
            }
        } catch (e) {
            console.error("Notepad: Error removing document: ", e);
        }
        });
    };

    window.resetNotepadNotesForCurrentTest = async function() {
        const testId = getCurrentTestId();
        if (testId) {
            try {
                const notesCollection = collection(db, "notes");
                const q = query(notesCollection, where("testId", "==", testId));
                const querySnapshot = await getDocs(q);
                
                const batch = writeBatch(db); // Sử dụng batch để xóa nhiều document hiệu quả
                querySnapshot.forEach((doc) => {
                    batch.delete(doc.ref);
                });
                await batch.commit();

                console.log(`Notepad notes for test ID '${testId}' have been reset.`);
                displayNotes();
                toggleNoteInputModal(false);
                applyNotedHighlights();
            } catch (e) {
                console.error("Notepad: Error resetting notes for current test:", e);
            }
        } else {
            console.warn("Notepad: Could not determine current test ID. Notes not reset.");
        }
    };

    // --- FIREBASE INTEGRATION END ---

    async function displayNotes(searchText = '') {
        notesList.innerHTML = '';
        const notes = await loadNotes();
        const sortedNoteIds = Object.keys(notes).sort((a, b) => notes[b].timestamp - notes[a].timestamp);

        if (sortedNoteIds.length === 0 && !searchText) {
            notesList.innerHTML = '<p class="no-notes-message">No notes yet. Start writing!</p>';
            return;
        }

        let foundNotes = false;
        sortedNoteIds.forEach(noteId => {
            const note = notes[noteId];
            const lowerCaseSearchText = searchText.toLowerCase();

            if (searchText &&
                !(note.content && note.content.toLowerCase().includes(lowerCaseSearchText)) &&
                !(note.highlightedText && note.highlightedText.toLowerCase().includes(lowerCaseSearchText))) {
                return;
            }
            foundNotes = true;

            const noteItem = document.createElement('div');
            noteItem.className = 'note-item';
            noteItem.dataset.id = noteId;

            if (note.highlightedText) {
                const highlightedTextElement = document.createElement('div');
                highlightedTextElement.className = 'note-highlighted-text';
                highlightedTextElement.textContent = `"${note.highlightedText}"`;
                noteItem.appendChild(highlightedTextElement);
            }

            const noteContent = document.createElement('div');
            noteContent.className = 'note-content';
            noteContent.textContent = note.content || 'No content';
            noteItem.appendChild(noteContent);

            const noteActionsWrapper = document.createElement('div');
            noteActionsWrapper.className = 'note-actions-wrapper';

            const noteMenuToggle = document.createElement('button');
            noteMenuToggle.className = 'note-menu-toggle';
            noteMenuToggle.innerHTML = '&#8942;';
            noteMenuToggle.setAttribute('aria-label', 'Note options');

            const noteDropdown = document.createElement('div');
            noteDropdown.className = 'note-actions-dropdown';
            noteDropdown.innerHTML = `
                <button class="edit-note-btn"><img src="PNG/edit_icon.png" alt="Edit"> Edit</button>
                <button class="delete-note-btn"><img src="PNG/delete_icon.png" alt="Delete"> Delete</button>
            `;

            noteActionsWrapper.appendChild(noteMenuToggle);
            noteActionsWrapper.appendChild(noteDropdown);
            noteItem.appendChild(noteActionsWrapper);

            noteMenuToggle.addEventListener('click', (event) => {
                event.stopPropagation();
                document.querySelectorAll('.note-actions-dropdown.active').forEach(d => {
                    if (d !== noteDropdown) {
                        d.classList.remove('active');
                    }
                });
                noteDropdown.classList.toggle('active');
            });

            noteDropdown.querySelector('.edit-note-btn').addEventListener('click', (event) => {
                event.stopPropagation();
                editNote(noteId);
                noteDropdown.classList.remove('active');
            });

            noteDropdown.querySelector('.delete-note-btn').addEventListener('click', (event) => {
                event.stopPropagation();
                window.deleteNote(noteId); // Call the global delete function
                noteDropdown.classList.remove('active');
            });

            notesList.appendChild(noteItem);
        });

        if (!foundNotes && searchText) {
            notesList.innerHTML = '<p class="no-notes-message">No matching notes found.</p>';
        }
    }

    function toggleNotepad(isOpen) {
        if (isOpen) {
            notepadSidebar.classList.add('active');
            if (notepadToggleBtn) {
                notepadToggleBtn.classList.add('active');
            }
            displayNotes();
            applyNotedHighlights();
        } else {
            notepadSidebar.classList.remove('active');
            if (notepadToggleBtn) {
                notepadToggleBtn.classList.remove('active');
            }
            toggleNoteInputModal(false);
        }
    }

    function toggleNoteInputModal(isOpen, x = 0, y = 0) {
        if (isOpen) {
            noteInputModal.style.left = `${x}px`;
            noteInputModal.style.top = `${y}px`;

            const modalRect = noteInputModal.getBoundingClientRect();
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

            if (modalRect.right > viewportWidth - 10) {
                noteInputModal.style.left = `${viewportWidth - modalRect.width - 10}px`;
            }
            if (modalRect.bottom > viewportHeight - 10) {
                noteInputModal.style.top = `${viewportHeight - modalRect.height - 10}px`;
            }
            if (modalRect.left < 10) {
                noteInputModal.style.left = `10px`;
            }
            if (modalRect.top < 10) {
                noteInputModal.style.top = `10px`;
            }

            noteInputModal.classList.add('visible');
            modalNewNoteTextarea.focus();
        } else {
            noteInputModal.classList.remove('visible');
            setTimeout(() => {
                modalNewNoteTextarea.value = '';
                currentHighlightedText = '';
                currentSelectionRangeForNote = null;
                editingNoteId = null;
                modalSaveNoteBtn.textContent = 'Save';
                modalCancelNoteBtn.textContent = 'Cancel';
            }, 200);
        }
    }

    if (modalSaveNoteBtn) {
        modalSaveNoteBtn.addEventListener('click', async (event) => {
            return window.withButtonLock(event, async () => {
            const content = modalNewNoteTextarea.value.trim();
            if (content || currentHighlightedText) {
                let rangeData = null;
                if (currentSelectionRangeForNote) {
                    try {
                        let container = currentSelectionRangeForNote.commonAncestorContainer;
                        // Sửa lỗi: Kiểm tra nếu container là TextNode, chúng ta cần tìm parentElement
                        if (container.nodeType === Node.TEXT_NODE) {
                            container = container.parentNode;
                        }

                        let rootForPaths = container.closest('#exam-instructions, #exam-questions');

                        if (!rootForPaths) {
                            rootForPaths = document.body;
                            console.warn("No specific #exam-instructions or #exam-questions ancestor found for range. Using document.body as root for path serialization. This might be less robust.");
                        }

                        rangeData = {
                            rootId: rootForPaths.id || 'document.body',
                            startPath: getPathToNode(currentSelectionRangeForNote.startContainer, rootForPaths),
                            startOffset: currentSelectionRangeForNote.startOffset,
                            endPath: getPathToNode(currentSelectionRangeForNote.endContainer, rootForPaths),
                            endOffset: currentSelectionRangeForNote.endOffset
                        };
                    } catch (e) {
                        console.error("Error serializing range:", e);
                        rangeData = null;
                    }
                }

                const noteData = {
                    content: content,
                    highlightedText: currentHighlightedText,
                    timestamp: Date.now(),
                    rangeData: rangeData
                };
                console.log("Saving note with rangeData:", rangeData);

                const savedNoteId = await saveNote(noteData, editingNoteId);
                if (savedNoteId && currentSelectionRangeForNote) {
                    try {
                        wrapRangeText(currentSelectionRangeForNote.cloneRange(), 'noted-text', {
                            'data-note-id': savedNoteId
                        });
                    } catch (e) {
                        console.warn("Notepad: Could not apply immediate noted highlight:", e);
                    }
                }
                toggleNoteInputModal(false);
                displayNotes();
                applyNotedHighlights();
            } else {
                alert('Note content or highlighted text cannot be entirely empty.');
            }
            });
        });
    }

    if (modalCancelNoteBtn) {
        modalCancelNoteBtn.addEventListener('click', () => {
            toggleNoteInputModal(false);
        });
    }

    async function editNote(id) {
        const notes = await loadNotes();
        const noteToEdit = notes[id];
        if (noteToEdit) {
            toggleNoteInputModal(true, window.innerWidth / 2 - 140, window.innerHeight / 2 - 100);
            modalNewNoteTextarea.value = noteToEdit.content;
            currentHighlightedText = noteToEdit.highlightedText || '';
            editingNoteId = id;
            modalSaveNoteBtn.textContent = 'Update';
            modalCancelNoteBtn.textContent = 'Discard';
            modalNewNoteTextarea.focus();
        }
    }

    if (notepadSearchInput) {
        notepadSearchInput.addEventListener('input', (event) => {
            displayNotes(event.target.value.trim());
        });
    }

    if (notepadToggleBtn) {
        notepadToggleBtn.addEventListener('click', () => {
            toggleNotepad(!notepadSidebar.classList.contains('active'));
        });
    }

    if (notepadCloseBtn) {
        notepadCloseBtn.addEventListener('click', () => {
            toggleNotepad(false);
        });
    }

    document.addEventListener('click', (event) => {
        document.querySelectorAll('.note-actions-dropdown.active').forEach(dropdown => {
            const noteItem = dropdown.closest('.note-item');
            if (noteItem && !noteItem.contains(event.target)) {
                dropdown.classList.remove('active');
            }
        });

        const isClickInsideNotepad = notepadSidebar && notepadSidebar.contains(event.target);
        const isClickOnToggleBtn = notepadToggleBtn && (event.target === notepadToggleBtn || notepadToggleBtn.contains(event.target));
        const isClickOnTooltip = event.target.closest('#selection-tooltip');
        const isClickInsideNoteModal = noteInputModal && noteInputModal.contains(event.target);
        const isClickOnHamburgerMenu = document.getElementById('svg-hamburger-btn') && (event.target === document.getElementById('svg-hamburger-btn') || document.getElementById('svg-hamburger-btn').contains(event.target));
        const isClickInsideHamburgerMenuDropdown = document.getElementById('hamburger-menu') && document.getElementById('hamburger-menu').contains(event.target);

        if (notepadSidebar.classList.contains('active') &&
            !isClickInsideNotepad &&
            !isClickOnToggleBtn &&
            !isClickOnTooltip &&
            !isClickInsideNoteModal &&
            !isClickOnHamburgerMenu &&
            !isClickInsideHamburgerMenuDropdown) {
            toggleNotepad(false);
        }

        if (noteInputModal.classList.contains('visible') &&
            !isClickInsideNoteModal &&
            !isClickOnTooltip) {
            toggleNoteInputModal(false);
        }
    });

    window.openNotepadWithSelection = (selectedText, x, y, selectionRange) => {
        currentHighlightedText = selectedText;
        currentSelectionRangeForNote = selectionRange;
        editingNoteId = null;
        modalNewNoteTextarea.value = '';
        modalSaveNoteBtn.textContent = 'Save';
        modalCancelNoteBtn.textContent = 'Cancel';

        toggleNoteInputModal(true, x, y);

        if (notepadSidebar && !notepadSidebar.classList.contains('active')) {
            toggleNotepad(true);
        }
    };
    

    async function applyNotedHighlights() {
        console.log('Applying noted highlights...');

        const existingNotedSpans = document.querySelectorAll('.noted-text');
        existingNotedSpans.forEach(span => {
            const parent = span.parentNode;
            if (parent) {
                while (span.firstChild) {
                    parent.insertBefore(span.firstChild, span);
                }
                parent.removeChild(span);
                parent.normalize();
            }
        });

        const notes = await loadNotes();
        const passages = document.querySelectorAll('#exam-instructions, #exam-questions');

        Object.values(notes).forEach(note => {
            if (!note.highlightedText) {
                return;
            }

            let highlightApplied = false;

            if (note.rangeData) {
                try {
                    let rootElement = null;
                    if (note.rangeData.rootId === 'document.body') {
                        rootElement = document.body;
                    } else if (note.rangeData.rootId) {
                        rootElement = document.getElementById(note.rangeData.rootId);
                    }

                    if (rootElement) {
                        const startNode = getNodeFromPath(note.rangeData.startPath, rootElement);
                        const endNode = getNodeFromPath(note.rangeData.endPath, rootElement);

                        if (startNode && endNode) {
                            const range = document.createRange();
                            range.setStart(startNode, note.rangeData.startOffset);
                            range.setEnd(endNode, note.rangeData.endOffset);

                            if (range.toString().trim() === note.highlightedText.trim()) {
                                try {
                                    const spans = wrapRangeText(range, 'noted-text', {
                                        'data-note-id': note.id
                                    });
                                    highlightApplied = spans.length > 0;
                                    if (!highlightApplied) {
                                        console.warn("Notepad: Stored rangeData matched text, but no text nodes were wrapped.");
                                    }
                                } catch (e) {
                                    console.warn("Notepad: Could not wrap stored rangeData highlight. Error:", e);
                                }
                            } else {
                                console.warn("Notepad: Text from reconstructed range does not match stored highlightedText. Falling back to text search. Reconstructed:", range.toString(), "Stored:", note.highlightedText);
                            }
                        } else {
                            console.warn("Notepad: Could not reconstruct nodes from rangeData paths. Falling back to text search.");
                        }
                    } else {
                        console.warn("Notepad: Root element for rangeData not found. Falling back to text search.");
                    }
                } catch (e) {
                    console.error("Notepad: Error using stored rangeData for highlighting, falling back to text search:", e);
                }
            }

            if (!highlightApplied) {
                const targetText = note.highlightedText.trim();

                passages.forEach(passage => {
                    const treeWalker = document.createTreeWalker(
                        passage,
                        NodeFilter.SHOW_TEXT,
                        {
                            acceptNode: function(node) {
                                if (node.parentNode.nodeName === 'SCRIPT' ||
                                    node.parentNode.nodeName === 'STYLE' ||
                                    node.parentNode.classList.contains('noted-text')) {
                                    return NodeFilter.FILTER_REJECT;
                                }
                                return NodeFilter.FILTER_ACCEPT;
                            }
                        },
                        false
                    );

                    let textNodeChunks = [];
                    let currentConcatenatedText = '';

                    let currentNode = treeWalker.nextNode();
                    while (currentNode) {
                        textNodeChunks.push({ node: currentNode, originalText: currentNode.nodeValue });
                        currentConcatenatedText += currentNode.nodeValue;
                        currentNode = treeWalker.nextNode();
                    }

                    let globalStartIndex = -1;
                    let currentSearchIndex = 0;

                    while ((globalStartIndex = currentConcatenatedText.indexOf(targetText, currentSearchIndex)) !== -1) {
                        const globalEndIndex = globalStartIndex + targetText.length;

                        let startNode = null;
                        let endNode = null;
                        let startOffset = -1;
                        let endOffset = -1;
                        let currentGlobalCharCount = 0;

                        for (let i = 0; i < textNodeChunks.length; i++) {
                            const chunk = textNodeChunks[i];
                            const nodeTextLength = chunk.originalText.length;

                            if (globalStartIndex >= currentGlobalCharCount && globalStartIndex < currentGlobalCharCount + nodeTextLength) {
                                startNode = chunk.node;
                                startOffset = globalStartIndex - currentGlobalCharCount;
                            }

                            if (globalEndIndex > currentGlobalCharCount && globalEndIndex <= currentGlobalCharCount + nodeTextLength) {
                                endNode = chunk.node;
                                endOffset = globalEndIndex - currentGlobalCharCount;
                            }

                            if (startNode && endNode) {
                                if (!passage.contains(startNode) || !passage.contains(endNode)) {
                                    startNode = null; endNode = null;
                                }
                                break;
                            }
                            currentGlobalCharCount += nodeTextLength;
                        }

                        if (startNode && endNode && startOffset !== -1 && endOffset !== -1) {
                            const range = document.createRange();
                            try {
                                range.setStart(startNode, startOffset);
                                range.setEnd(endNode, endOffset);

                                if (range.toString().trim() === targetText) {
                                    const spans = wrapRangeText(range, 'noted-text', {
                                        'data-note-id': note.id
                                    });
                                    highlightApplied = spans.length > 0;
                                    if (!highlightApplied) {
                                        console.warn("Notepad: Text search matched range, but no text nodes were wrapped.");
                                    }
                                } else {
                                    console.warn("Notepad: Range content does not match targetText during text search. Expected:", targetText, "Got:", range.toString());
                                }
                            } catch (e) {
                                console.warn("Notepad: Could not create or set range during text search. Highlighted text:", targetText, "Error:", e);
                            }
                        } else {
                            console.warn("Notepad: Could not determine valid start/end nodes for highlight during text search. Highlighted text:", targetText);
                        }

                        if (highlightApplied) {
                            break;
                        }
                        currentSearchIndex = globalEndIndex;
                    }
                });
            }
            if (!highlightApplied) {
                console.warn(`Notepad: Failed to apply highlight for note ID ${note.id} (text: "${note.highlightedText}") using both rangeData and text search.`);
            }
        });
        console.log('Finished applying noted highlights.');
    }

    displayNotes();
    applyNotedHighlights();
    window.applyNotedHighlights = applyNotedHighlights;
});
