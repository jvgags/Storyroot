/* ========== STORYROOT - NOTE-TAKING APP ========== */

// Global Variables
let notes = [];
let folders = [];
let settings = {
    theme: 'light',
    fontSize: 16,
    fontFamily: 'monospace',
    autoSave: true,
    vimMode: false,
    lastOpenedNote: null
};

let currentNoteId = null;
let openTabs = []; // Array of note IDs that are open in tabs
let currentEditMode = 'edit'; // 'edit', 'preview', 'split'
let autoSaveTimer = null;
let hasUnsavedChanges = false;
let editor = null; // CodeMirror instance
let _settingEditorValue = false; // Suppress change events during setValue

// IndexedDB Setup
const DB_NAME = 'StoryrootDB';
const DB_VERSION = 1;
const STORE_NOTES = 'notes';
const STORE_FOLDERS = 'folders';
const STORE_SETTINGS = 'settings';
let db;

// Modal state
let renameTarget = null;
let deleteTarget = null;
let isCreating = false; // Track if we're creating vs renaming

// Drag and drop state
let draggedItem = null;
let draggedType = null; // 'note' or 'folder'

/* ========== DATABASE FUNCTIONS ========== */

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (e) => {
            db = e.target.result;
            
            if (!db.objectStoreNames.contains(STORE_NOTES)) {
                const notesStore = db.createObjectStore(STORE_NOTES, { keyPath: 'id' });
                notesStore.createIndex('title', 'title', { unique: false });
                notesStore.createIndex('folderId', 'folderId', { unique: false });
                notesStore.createIndex('modified', 'modified', { unique: false });
            }
            
            if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
                db.createObjectStore(STORE_FOLDERS, { keyPath: 'id' });
            }
            
            if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
                db.createObjectStore(STORE_SETTINGS, { keyPath: 'id' });
            }
        };

        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };

        request.onerror = (e) => {
            console.error('IndexedDB error:', e);
            reject(e);
        };
    });
}

async function saveNote(note) {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NOTES, 'readwrite');
        tx.objectStore(STORE_NOTES).put(note);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
    });
}

async function loadNotes() {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NOTES, 'readonly');
        const request = tx.objectStore(STORE_NOTES).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (e) => reject(e);
    });
}

async function deleteNote(id) {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NOTES, 'readwrite');
        tx.objectStore(STORE_NOTES).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
    });
}

async function saveFolder(folder) {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_FOLDERS, 'readwrite');
        tx.objectStore(STORE_FOLDERS).put(folder);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
    });
}

async function loadFolders() {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_FOLDERS, 'readonly');
        const request = tx.objectStore(STORE_FOLDERS).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (e) => reject(e);
    });
}

async function deleteFolder(id) {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_FOLDERS, 'readwrite');
        tx.objectStore(STORE_FOLDERS).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
    });
}

async function saveSettings() {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SETTINGS, 'readwrite');
        tx.objectStore(STORE_SETTINGS).put({ id: 'settings', ...settings });
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
    });
}

async function loadSettings() {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SETTINGS, 'readonly');
        const request = tx.objectStore(STORE_SETTINGS).get('settings');
        request.onsuccess = () => {
            if (request.result) {
                settings = { ...settings, ...request.result };
            }
            resolve();
        };
        request.onerror = (e) => reject(e);
    });
}

/* ========== INITIALIZATION ========== */

window.onload = async function() {
    try {
        await openDB();
        await loadSettings();
        notes = await loadNotes();
        folders = await loadFolders();
        
        console.log('Storyroot loaded:', {
            notes: notes.length,
            folders: folders.length,
            settings: settings
        });
    } catch (e) {
        console.error('Failed to load data:', e);
        showToast('Failed to load data from database');
    }
    
    // Migration: Add order field to notes that don't have it
    let needsSave = false;
    notes.forEach((note, index) => {
        if (note.order === undefined) {
            note.order = index * 1000; // Space them out by 1000
            needsSave = true;
        }
    });
    if (needsSave) {
        // Save all migrated notes
        for (const note of notes) {
            await saveNote(note);
        }
    }
    
    // Migration: Add order field to folders that don't have it
    let folderNeedsSave = false;
    folders.forEach((folder, index) => {
        if (folder.order === undefined) {
            folder.order = index * 1000;
            folderNeedsSave = true;
        }
    });
    if (folderNeedsSave) {
        // Save all migrated folders
        for (const folder of folders) {
            await saveFolder(folder);
        }
    }

    // Apply saved theme
    if (settings.theme) {
        document.documentElement.setAttribute('data-theme', settings.theme);
        const themeSelect = document.getElementById('themeSelect');
        if (themeSelect) themeSelect.value = settings.theme;
    }

    // Apply saved font family
    if (settings.fontFamily) {
        applyFontFamily(settings.fontFamily);
        const fontFamilySelect = document.getElementById('fontFamilySelect');
        if (fontFamilySelect) fontFamilySelect.value = settings.fontFamily;
    }

    // Apply saved font size (will be applied to CodeMirror after initialization)
    if (settings.fontSize) {
        document.documentElement.style.setProperty('--editor-font-size', settings.fontSize + 'px');
        const preview = document.getElementById('markdownPreview');
        preview.style.fontSize = settings.fontSize + 'px';
        
        const fontSizeRange = document.getElementById('fontSizeRange');
        const fontSizeValue = document.getElementById('fontSizeValue');
        if (fontSizeRange) fontSizeRange.value = settings.fontSize;
        if (fontSizeValue) fontSizeValue.textContent = settings.fontSize + 'px';
    }
    
    // Apply saved auto-save setting
    const autoSaveCheckbox = document.getElementById('autoSaveCheckbox');
    if (autoSaveCheckbox) autoSaveCheckbox.checked = settings.autoSave;
    
    // Apply saved vim mode setting
    const vimModeCheckbox = document.getElementById('vimModeCheckbox');
    if (vimModeCheckbox) vimModeCheckbox.checked = settings.vimMode;

    // Initialize CodeMirror
    initializeCodeMirror();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // F11 or Ctrl+Shift+F → distraction-free
        if (e.key === 'F11' || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'f')) {
            e.preventDefault();
            toggleDistractionFree();
        }

        // Escape → exit distraction-free if active
        if (e.key === 'Escape' && document.body.classList.contains('distraction-free')) {
            e.preventDefault();
            exitDistractionFree();
            return;
        }

        // Ctrl+S or Cmd+S to save
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveCurrentNote();
        }
        
        // Ctrl+N or Cmd+N to create new note
        if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
            e.preventDefault();
            createNewNote();
        }
        
        // Ctrl+D or Cmd+D to duplicate current note
        if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
            e.preventDefault();
            if (currentNoteId) {
                duplicateNote(currentNoteId);
            }
        }
        
        // Ctrl+F or Cmd+F to open search panel
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            openSearchPanel();
        }
        
        // Ctrl+H or Cmd+H to open search and replace panel
        if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
            e.preventDefault();
            openSearchPanel(true);
        }
        
        // Formatting shortcuts (only when editor is focused)
        const editor = document.getElementById('markdownEditor');
        if (document.activeElement === editor) {
            // Ctrl+B for bold
            if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
                e.preventDefault();
                insertFormatting('bold');
            }
            
            // Ctrl+I for italic
            if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
                e.preventDefault();
                insertFormatting('italic');
            }
            
            // Ctrl+K for link
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                insertFormatting('link');
            }
        }
    });

    // Close context menus when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.item-ellipsis-btn') && !e.target.closest('.item-actions')) {
            closeContextMenus();
        }
    });

    // Update UI
    renderFileExplorer();
    
    // Set initial view mode to edit
    switchEditorTab('edit');
    
    if (notes.length === 0) {
        showEmptyState();
    } else if (settings.lastOpenedNote) {
        openNote(settings.lastOpenedNote);
    }
};

/* ========== CODEMIRROR INITIALIZATION ========== */

function initializeCodeMirror() {
    const editorElement = document.getElementById('markdownEditor');
    
    // Create CodeMirror editor
    editor = CodeMirror(editorElement, {
        mode: 'markdown',
        lineNumbers: false,
        lineWrapping: true,
        theme: getCodeMirrorTheme(),
        autofocus: false,
        spellcheck: true,
        autocorrect: true,
        // Make headers bold with custom styling
        configureMouse: () => ({ addNew: false })
    });
    
    // Set initial font size
    if (settings.fontSize) {
        editor.getWrapperElement().style.fontSize = settings.fontSize + 'px';
    }
    
    // Listen for changes
    editor.on('change', () => {
        if (_settingEditorValue) return; // Suppress during setValue
        hasUnsavedChanges = true;
        if (currentNoteId) {
            updatePreview();
            resetAutoSaveTimer();
        }
        if (document.body.classList.contains('distraction-free')) {
            updateDFStats();
        }
    });
}

function getCodeMirrorTheme() {
    // Always use 'default' theme so our CSS variables control the colors
    // This ensures consistent theming across all theme options
    return 'default';
}

/* ========== NOTE MANAGEMENT ========== */

function createNewNote() {
    const note = {
        id: generateId(),
        title: 'Untitled Note',
        content: '',
        folderId: null,
        tags: [],
        highlights: [],
        order: Date.now(), // Use timestamp for initial ordering
        created: new Date().toISOString(),
        modified: new Date().toISOString()
    };
    
    notes.push(note);
    saveNote(note);
    renderFileExplorer();
    openNote(note.id);
    showToast('New note created');
    
    // Focus on title for renaming
    setTimeout(() => {
        const noteElement = document.querySelector(`[data-note-id="${note.id}"]`);
        if (noteElement) {
            isCreating = true; // Mark as creation
            renameTarget = { type: 'note', id: note.id };
            openRenameModal(note.title);
        }
    }, 100);
}

function createNoteInFolder(folderId) {
    const note = {
        id: generateId(),
        title: 'Untitled Note',
        content: '',
        folderId: folderId,
        tags: [],
        order: Date.now(), // Use timestamp for initial ordering
        created: new Date().toISOString(),
        modified: new Date().toISOString()
    };
    
    // Make sure folder is expanded
    const folder = folders.find(f => f.id === folderId);
    if (folder && folder.collapsed) {
        folder.collapsed = false;
        saveFolder(folder);
    }
    
    notes.push(note);
    saveNote(note);
    renderFileExplorer();
    openNote(note.id);
    showToast('New note created in folder');
    
    // Focus on title for renaming
    setTimeout(() => {
        const noteElement = document.querySelector(`[data-note-id="${note.id}"]`);
        if (noteElement) {
            isCreating = true; // Mark as creation
            renameTarget = { type: 'note', id: note.id };
            openRenameModal(note.title);
        }
    }, 100);
}

function openNote(noteId) {
    console.log('openNote called with noteId:', noteId);
    const note = notes.find(n => n.id === noteId);
    if (!note) {
        console.error('Note not found:', noteId);
        return;
    }

    // Add to tabs if not already open
    if (!openTabs.includes(noteId)) {
        openTabs.push(noteId);
        renderTabs();
    }
    
    currentNoteId = noteId;
    hasUnsavedChanges = false;
    
    // Update CodeMirror editor — suppress change handler during setValue
    if (editor) {
        _settingEditorValue = true;
        editor.setValue(note.content || '');
        _settingEditorValue = false;
    }
    
    // Ensure highlights array exists
    if (!note.highlights) note.highlights = [];
    
    // Apply highlight markers to CodeMirror (after setValue is fully done)
    applyHighlightMarkers(note);
    
    // Always extract fresh tags and links from content for sidebar display
    note.tags = extractTags(note.content || '');
    note.links = extractLinks(note.content || '');
    
    // Update UI
    hideEmptyState();
    updateBreadcrumb(note);
    updatePreview();
    console.log('About to call updateRightSidebar with tags:', note.tags, 'links:', note.links);
    updateRightSidebar(note);
    console.log('updateRightSidebar called');
    updateActiveNote();
    renderTabs(); // Update tab highlighting
    
    // Refresh the current edit mode to ensure the view is updated correctly
    switchEditorTab(currentEditMode);
    
    // Save last opened note
    settings.lastOpenedNote = noteId;
    saveSettings();
}

function renderTabs() {
    const tabsBar = document.getElementById('noteTabsBar');
    if (!tabsBar) return;
    
    tabsBar.innerHTML = '';
    
    openTabs.forEach(noteId => {
        const note = notes.find(n => n.id === noteId);
        if (!note) return;
        
        const tab = document.createElement('div');
        tab.className = 'note-tab';
        if (noteId === currentNoteId) {
            tab.classList.add('active');
        }
        
        tab.innerHTML = `
            <span class="note-tab-icon">📄</span>
            <span class="note-tab-title">${escapeHtml(note.title)}</span>
            <span class="note-tab-close">×</span>
        `;
        
        // Handle close button click
        const closeBtn = tab.querySelector('.note-tab-close');
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            closeTab(noteId, e);
        };
        
        // Handle tab click (switch to this note)
        tab.onclick = (e) => {
            if (!e.target.classList.contains('note-tab-close')) {
                switchToTab(noteId);
            }
        };
        
        tabsBar.appendChild(tab);
    });
}

function switchToTab(noteId) {
    console.log('switchToTab called with noteId:', noteId, 'currentNoteId:', currentNoteId);
    
    if (currentNoteId === noteId) {
        console.log('Already on this tab, skipping');
        return;
    }
    
    // Save current note (syncs live marker positions → stored offsets, then persists)
    if (currentNoteId && settings.autoSave) {
        saveCurrentNote(true); // Pass true to skip sidebar update
    } else if (currentNoteId) {
        // Even without auto-save, sync marker positions so they survive the tab switch
        const currentNote = notes.find(n => n.id === currentNoteId);
        if (currentNote) syncHighlightPositionsFromMarkers(currentNote);
    }
    
    openNote(noteId);
}

function closeTab(noteId, event) {
    if (event) {
        event.stopPropagation();
    }
    
    // Save note before closing if needed
    if (noteId === currentNoteId && settings.autoSave && hasUnsavedChanges) {
        saveCurrentNote();
    }
    
    // Remove from open tabs
    const tabIndex = openTabs.indexOf(noteId);
    if (tabIndex === -1) return;
    
    openTabs.splice(tabIndex, 1);
    
    // If this was the current note, switch to another tab or show empty state
    if (noteId === currentNoteId) {
        if (openTabs.length > 0) {
            // Switch to the previous tab, or the next one if we closed the first tab
            const newIndex = Math.max(0, tabIndex - 1);
            openNote(openTabs[newIndex]);
        } else {
            currentNoteId = null;
            if (editor) { editor.setValue(''); };
            showEmptyState();
        }
    }
    
    renderTabs();
}

async function saveCurrentNote(skipSidebarUpdate = false) {
    if (!currentNoteId) return;
    
    const note = notes.find(n => n.id === currentNoteId);
    if (!note) return;
    
    note.content = getEditorPlainText();
    note.modified = new Date().toISOString();
    
    // Extract tags and links
    note.tags = extractTags(note.content);
    note.links = extractLinks(note.content);

    // Sync highlight positions from live CodeMirror markers back to stored offsets
    // (markers self-track as the user types, so this keeps stored indices accurate)
    syncHighlightPositionsFromMarkers(note);
    
    await saveNote(note);
    hasUnsavedChanges = false;
    
    // Update UI (skip sidebar update if switching tabs)
    if (!skipSidebarUpdate) {
        updateRightSidebar(note);
    }
    renderFileExplorer();
    
    showToast('Note saved');
}

function deleteNoteById(noteId) {
    deleteTarget = { type: 'note', id: noteId };
    const note = notes.find(n => n.id === noteId);
    document.getElementById('deleteMessage').textContent = 
        `Are you sure you want to delete "${note.title}"?`;
    openDeleteModal();
}

async function duplicateNote(noteId) {
    const originalNote = notes.find(n => n.id === noteId);
    if (!originalNote) return;
    
    // Create a copy with a new ID and updated title
    const duplicatedNote = {
        id: generateId(),
        title: originalNote.title + ' (Copy)',
        content: originalNote.content,
        folderId: originalNote.folderId,
        tags: [...(originalNote.tags || [])],
        links: [...(originalNote.links || [])],
        order: Date.now(), // New order value
        created: new Date().toISOString(),
        modified: new Date().toISOString()
    };
    
    notes.push(duplicatedNote);
    await saveNote(duplicatedNote);
    
    renderFileExplorer();
    openNote(duplicatedNote.id);
    showToast('Note duplicated');
}

async function confirmDelete() {
    if (!deleteTarget) return;
    
    if (deleteTarget.type === 'note') {
        await deleteNote(deleteTarget.id);
        notes = notes.filter(n => n.id !== deleteTarget.id);
        
        // Close the tab for this note
        const tabIndex = openTabs.indexOf(deleteTarget.id);
        if (tabIndex !== -1) {
            closeTab(deleteTarget.id);
        }
        
        renderFileExplorer();
        showToast('Note deleted');
    } else if (deleteTarget.type === 'folder') {
        // Delete folder and all notes in it (including subfolders)
        const foldersToDelete = getAllSubfolders(deleteTarget.id);
        foldersToDelete.push(deleteTarget.id);
        
        // Delete all notes in these folders
        const notesToDelete = notes.filter(n => foldersToDelete.includes(n.folderId));
        for (const note of notesToDelete) {
            await deleteNote(note.id);
            // Close tabs for deleted notes
            const tabIndex = openTabs.indexOf(note.id);
            if (tabIndex !== -1) {
                openTabs.splice(tabIndex, 1);
            }
        }
        notes = notes.filter(n => !foldersToDelete.includes(n.folderId));
        
        // Delete all folders
        for (const folderId of foldersToDelete) {
            await deleteFolder(folderId);
        }
        folders = folders.filter(f => !foldersToDelete.includes(f.id));
        
        // Update UI if current note was deleted
        if (currentNoteId && !notes.find(n => n.id === currentNoteId)) {
            if (openTabs.length > 0) {
                openNote(openTabs[0]);
            } else {
                currentNoteId = null;
                if (editor) { editor.setValue(''); };
                showEmptyState();
            }
        }
        
        renderTabs();
        renderFileExplorer();
        showToast('Folder deleted');
    }
    
    closeDeleteModal();
    deleteTarget = null;
}

function getAllSubfolders(folderId) {
    const subfolders = [];
    const directChildren = folders.filter(f => f.parentFolderId === folderId);
    
    directChildren.forEach(child => {
        subfolders.push(child.id);
        const childSubfolders = getAllSubfolders(child.id);
        subfolders.push(...childSubfolders);
    });
    
    return subfolders;
}

/* ========== FOLDER MANAGEMENT ========== */

function createNewFolder() {
    const folder = {
        id: generateId(),
        name: 'New Folder',
        parentFolderId: null,
        collapsed: false,
        order: Date.now()
    };
    
    folders.push(folder);
    saveFolder(folder);
    renderFileExplorer();
    
    // Focus on folder for renaming
    setTimeout(() => {
        isCreating = true; // Mark as creation
        renameTarget = { type: 'folder', id: folder.id };
        openRenameModal(folder.name);
    }, 100);
}

function createSubfolder(parentFolderId) {
    const folder = {
        id: generateId(),
        name: 'New Folder',
        parentFolderId: parentFolderId,
        collapsed: false,
        order: Date.now()
    };
    
    // Make sure parent folder is expanded
    const parentFolder = folders.find(f => f.id === parentFolderId);
    if (parentFolder && parentFolder.collapsed) {
        parentFolder.collapsed = false;
        saveFolder(parentFolder);
    }
    
    folders.push(folder);
    saveFolder(folder);
    renderFileExplorer();
    
    // Focus on folder for renaming
    setTimeout(() => {
        isCreating = true; // Mark as creation
        renameTarget = { type: 'folder', id: folder.id };
        openRenameModal(folder.name);
    }, 100);
}

function toggleFolder(folderId) {
    const folder = folders.find(f => f.id === folderId);
    if (folder) {
        folder.collapsed = !folder.collapsed;
        saveFolder(folder);
        renderFileExplorer();
    }
}

function deleteFolderById(folderId) {
    deleteTarget = { type: 'folder', id: folderId };
    const folder = folders.find(f => f.id === folderId);
    const noteCount = notes.filter(n => n.folderId === folderId).length;
    const subfolders = getAllSubfolders(folderId);
    const subfolderCount = subfolders.length;
    
    let message = `Are you sure you want to delete "${folder.name}"`;
    if (subfolderCount > 0) {
        message += `, ${subfolderCount} subfolder(s)`;
    }
    if (noteCount > 0) {
        message += `, and ${noteCount} note(s)`;
    }
    message += '?';
    
    document.getElementById('deleteMessage').textContent = message;
    openDeleteModal();
}

/* ========== DRAG AND DROP ========== */

// Active drop indicator element
let _dropIndicator = null;
// Current pending drop action: { type: 'before'|'after'|'into', targetEl, targetId, targetKind }
let _pendingDrop = null;

function _getOrCreateDropIndicator() {
    if (!_dropIndicator) {
        _dropIndicator = document.createElement('div');
        _dropIndicator.className = 'dnd-drop-indicator';
    }
    return _dropIndicator;
}

function _clearDropState() {
    // Remove indicator from DOM
    if (_dropIndicator && _dropIndicator.parentNode) {
        _dropIndicator.parentNode.removeChild(_dropIndicator);
    }
    // Clear nest highlight
    document.querySelectorAll('.dnd-nest-target').forEach(el => el.classList.remove('dnd-nest-target'));
    _pendingDrop = null;
}

function handleDragStart(e) {
    // Prevent dragging if clicking on interactive elements
    if (e.target.closest('.item-actions') ||
        e.target.closest('.item-ellipsis-btn') ||
        e.target.closest('.folder-toggle')) {
        e.preventDefault();
        return;
    }

    const target = e.currentTarget;
    draggedItem = target;

    if (target.hasAttribute('data-note-id')) {
        draggedType = 'note';
    } else if (target.hasAttribute('data-folder-id')) {
        draggedType = 'folder';
    }

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', target.getAttribute('data-note-id') || target.getAttribute('data-folder-id'));

    setTimeout(() => target.classList.add('dragging'), 0);
}

function handleDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    _clearDropState();
    draggedItem = null;
    draggedType = null;
}

// Unified dragover for all items (folders and notes)
function handleDragOver(e) {
    if (!draggedItem) return;

    const target = e.currentTarget;
    const targetIsFolder = target.hasAttribute('data-folder-id');
    const targetIsNote = target.hasAttribute('data-note-id');

    // A note being dragged can go before/after any item, or into a folder
    // A folder being dragged can go before/after any item, or into another folder (but not itself/children)
    if (draggedType === 'folder' && targetIsFolder) {
        const draggedFolderId = draggedItem.getAttribute('data-folder-id');
        const targetFolderId = target.getAttribute('data-folder-id');
        if (draggedFolderId === targetFolderId || isChildFolder(targetFolderId, draggedFolderId)) {
            return; // Can't drop into self or children
        }
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const rect = target.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;

    let zone;
    if (targetIsFolder) {
        // Top 30% → before, middle 40% → into, bottom 30% → after
        if (y < h * 0.30) zone = 'before';
        else if (y > h * 0.70) zone = 'after';
        else zone = 'into';
    } else {
        // Notes: top 50% → before, bottom 50% → after
        zone = y < h * 0.5 ? 'before' : 'after';
    }

    _applyDropVisual(target, zone, targetIsFolder ? target.getAttribute('data-folder-id') : null);
}

function _applyDropVisual(target, zone, folderId) {
    _clearDropState();
    const indicator = _getOrCreateDropIndicator();

    if (zone === 'into' && folderId) {
        target.classList.add('dnd-nest-target');
        _pendingDrop = { zone: 'into', targetEl: target, targetId: folderId, targetKind: 'folder' };
    } else {
        // Insert indicator before or after target in the DOM
        const explorer = document.getElementById('fileExplorer');
        if (zone === 'before') {
            explorer.insertBefore(indicator, target);
        } else {
            // Insert after: before the next sibling, or at end
            target.parentNode.insertBefore(indicator, target.nextSibling);
        }
        _pendingDrop = {
            zone,
            targetEl: target,
            targetId: target.getAttribute('data-folder-id') || target.getAttribute('data-note-id'),
            targetKind: target.hasAttribute('data-folder-id') ? 'folder' : 'note'
        };
    }
}

function handleDragLeave(e) {
    // Only clear if truly leaving the element (not entering a child)
    const related = e.relatedTarget;
    if (related && e.currentTarget.contains(related)) return;
    // Don't clear — let the next dragover on a new element clear it
    // This prevents flicker when moving between child elements
}

async function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedItem || !_pendingDrop) {
        _clearDropState();
        return;
    }

    const drop = _pendingDrop;
    _clearDropState();

    if (draggedType === 'note') {
        await _dropNote(drop);
    } else if (draggedType === 'folder') {
        await _dropFolder(drop);
    }
}

async function _dropNote(drop) {
    const noteId = draggedItem.getAttribute('data-note-id');
    const note = notes.find(n => n.id === noteId);
    if (!note) return;

    if (drop.zone === 'into') {
        // Move note into folder
        const targetFolderId = drop.targetId;
        if (note.folderId === targetFolderId) return;
        note.folderId = targetFolderId;
        note.modified = new Date().toISOString();

        const targetFolder = folders.find(f => f.id === targetFolderId);
        if (targetFolder && targetFolder.collapsed) {
            targetFolder.collapsed = false;
            await saveFolder(targetFolder);
        }

        await saveNote(note);
        renderFileExplorer();
        if (currentNoteId === note.id) updateBreadcrumb(note);
        showToast('Note moved into folder');

    } else {
        // Reorder note before/after target item
        const targetEl = drop.targetEl;
        const targetNoteId = targetEl.getAttribute('data-note-id');
        const targetFolderId = targetEl.getAttribute('data-folder-id');

        // Determine target context (what folder and what the adjacent items are)
        let newFolderId;
        if (targetNoteId) {
            const targetNote = notes.find(n => n.id === targetNoteId);
            newFolderId = targetNote ? targetNote.folderId : null;
        } else if (targetFolderId) {
            // Dropping next to a folder — go to same parent level
            const targetFolder = folders.find(f => f.id === targetFolderId);
            newFolderId = targetFolder ? targetFolder.parentFolderId : null;
        } else {
            newFolderId = null;
        }

        note.folderId = newFolderId;
        note.order = _calcOrderForNoteAdjacentTo(targetEl, drop.zone, newFolderId);
        note.modified = new Date().toISOString();
        await saveNote(note);
        renderFileExplorer();
        if (currentNoteId === note.id) updateBreadcrumb(note);
        showToast('Note moved');
    }
}

async function _dropFolder(drop) {
    const folderId = draggedItem.getAttribute('data-folder-id');
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return;

    if (drop.zone === 'into') {
        // Nest folder inside target folder
        const targetFolderId = drop.targetId;
        if (folderId === targetFolderId || isChildFolder(targetFolderId, folderId)) return;

        folder.parentFolderId = targetFolderId;
        folder.order = Date.now();

        const targetFolder = folders.find(f => f.id === targetFolderId);
        if (targetFolder && targetFolder.collapsed) {
            targetFolder.collapsed = false;
            await saveFolder(targetFolder);
        }

        await saveFolder(folder);
        renderFileExplorer();
        showToast('Folder moved inside folder');

    } else {
        // Reorder folder before/after target
        const targetEl = drop.targetEl;
        const targetFolderId = targetEl.getAttribute('data-folder-id');
        const targetNoteId = targetEl.getAttribute('data-note-id');

        let newParentFolderId;
        if (targetFolderId) {
            const targetFolder = folders.find(f => f.id === targetFolderId);
            newParentFolderId = targetFolder ? targetFolder.parentFolderId : null;
        } else if (targetNoteId) {
            const targetNote = notes.find(n => n.id === targetNoteId);
            newParentFolderId = targetNote ? targetNote.folderId : null;
        } else {
            newParentFolderId = null;
        }

        // Prevent dropping into own subtree
        if (newParentFolderId && isChildFolder(newParentFolderId, folderId)) return;

        folder.parentFolderId = newParentFolderId;
        folder.order = _calcOrderForFolderAdjacentTo(targetEl, drop.zone, newParentFolderId);

        await saveFolder(folder);
        renderFileExplorer();
        showToast('Folder moved');
    }
}

// Calculate order value for a note placed before/after a target element
function _calcOrderForNoteAdjacentTo(targetEl, zone, folderId) {
    // Get all items in the same context rendered in DOM order
    const explorer = document.getElementById('fileExplorer');
    const allItems = Array.from(explorer.querySelectorAll('[data-note-id], [data-folder-id]'));
    const targetIdx = allItems.indexOf(targetEl);

    // Find the rendered siblings that are notes in same folder
    const folderNotes = notes
        .filter(n => n.folderId === folderId)
        .sort((a, b) => (a.order || 0) - (b.order || 0));

    if (folderNotes.length === 0) return Date.now();

    const targetNoteId = targetEl.getAttribute('data-note-id');
    if (targetNoteId) {
        const tIdx = folderNotes.findIndex(n => n.id === targetNoteId);
        if (zone === 'before') {
            const prev = folderNotes[tIdx - 1];
            const cur = folderNotes[tIdx];
            return prev ? ((prev.order + cur.order) / 2) : (cur.order - 1000);
        } else {
            const cur = folderNotes[tIdx];
            const next = folderNotes[tIdx + 1];
            return next ? ((cur.order + next.order) / 2) : (cur.order + 1000);
        }
    }

    // Dropping next to a folder — place at start or end of folder's notes
    if (zone === 'before') {
        return (folderNotes[0].order || 0) - 1000;
    } else {
        return (folderNotes[folderNotes.length - 1].order || 0) + 1000;
    }
}

// Calculate order value for a folder placed before/after a target element
function _calcOrderForFolderAdjacentTo(targetEl, zone, parentFolderId) {
    const siblingFolders = folders
        .filter(f => f.parentFolderId === parentFolderId)
        .sort((a, b) => (a.order || 0) - (b.order || 0));

    const targetFolderId = targetEl.getAttribute('data-folder-id');
    if (targetFolderId && siblingFolders.length > 0) {
        const tIdx = siblingFolders.findIndex(f => f.id === targetFolderId);
        if (tIdx >= 0) {
            if (zone === 'before') {
                const prev = siblingFolders[tIdx - 1];
                const cur = siblingFolders[tIdx];
                return prev ? ((prev.order + cur.order) / 2) : (cur.order - 1000);
            } else {
                const cur = siblingFolders[tIdx];
                const next = siblingFolders[tIdx + 1];
                return next ? ((cur.order + next.order) / 2) : (cur.order + 1000);
            }
        }
    }

    // Fallback: place at end
    if (siblingFolders.length === 0) return Date.now();
    return (siblingFolders[siblingFolders.length - 1].order || 0) + 1000;
}

function isChildFolder(childId, parentId) {
    let currentFolder = folders.find(f => f.id === childId);
    while (currentFolder && currentFolder.parentFolderId) {
        if (currentFolder.parentFolderId === parentId) return true;
        currentFolder = folders.find(f => f.id === currentFolder.parentFolderId);
    }
    return false;
}

function handleRootDragOver(e) {
    if (e.target.id === 'fileExplorer' || e.target.classList.contains('file-explorer')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        // Show indicator at the very end of the list
        _clearDropState();
        const indicator = _getOrCreateDropIndicator();
        const explorer = document.getElementById('fileExplorer');
        explorer.appendChild(indicator);
        _pendingDrop = { zone: 'root-end', targetEl: null, targetId: null, targetKind: null };
    }
}

async function handleRootDrop(e) {
    if (e.target.id !== 'fileExplorer' && !e.target.classList.contains('file-explorer')) return;

    e.preventDefault();
    e.stopPropagation();

    _clearDropState();
    if (!draggedItem) return;

    if (draggedType === 'note') {
        const noteId = draggedItem.getAttribute('data-note-id');
        const note = notes.find(n => n.id === noteId);
        if (note) {
            note.folderId = null;
            note.order = Date.now();
            note.modified = new Date().toISOString();
            await saveNote(note);
            renderFileExplorer();
            if (currentNoteId === note.id) updateBreadcrumb(note);
            showToast('Note moved to root');
        }
    } else if (draggedType === 'folder') {
        const folderId = draggedItem.getAttribute('data-folder-id');
        const folder = folders.find(f => f.id === folderId);
        if (folder) {
            folder.parentFolderId = null;
            folder.order = Date.now();
            await saveFolder(folder);
            renderFileExplorer();
            showToast('Folder moved to root');
        }
    }
}

/* ========== MARKDOWN PROCESSING ========== */

function extractTags(content) {
    const tagRegex = /#(\w+)/g;
    const tags = [];
    let match;
    
    while ((match = tagRegex.exec(content)) !== null) {
        if (!tags.includes(match[1])) {
            tags.push(match[1]);
        }
    }
    
    return tags;
}

function extractLinks(content) {
    const linkRegex = /\[\[([^\]]+)\]\]/g;
    const links = [];
    let match;
    
    while ((match = linkRegex.exec(content)) !== null) {
        if (!links.includes(match[1])) {
            links.push(match[1]);
        }
    }
    
    return links;
}

// Track whether the user is actively editing in the preview pane
let _previewEditing = false;
let _previewSyncTimer = null;

function updatePreview() {
    // Don't reset the DOM while the user is actively typing in preview mode
    if (_previewEditing) return;
    
    const preview = document.getElementById('markdownPreview');
    
    let content = getEditorPlainText();
    
    // Process wiki links [[Note Name]]
    content = content.replace(/\[\[([^\]]+)\]\]/g, (match, linkText) => {
        const linkedNote = notes.find(n => 
            n.title.toLowerCase() === linkText.toLowerCase()
        );
        const className = linkedNote ? 'wiki-link' : 'wiki-link broken';
        const onClick = linkedNote ? `onclick="openNote('${linkedNote.id}')"` : '';
        return `<a href="#" class="${className}" ${onClick}>${linkText}</a>`;
    });
    
    // Process tags #tag
    content = content.replace(/#(\w+)/g, (match, tag) => {
        return `<span class="tag" onclick="searchByTag('${tag}')">#${tag}</span>`;
    });
    
    // Convert markdown to HTML
    const html = marked.parse(content);
    preview.innerHTML = DOMPurify.sanitize(html);
    
    // Apply highlights to preview
    if (currentNoteId) {
        const note = notes.find(n => n.id === currentNoteId);
        if (note && note.highlights && note.highlights.length > 0) {
            applyHighlightsToPreview(preview, note.highlights, getEditorPlainText());
        }
        
        if (note) {
            updateTableOfContents({ ...note, content: getEditorPlainText() });
        }
    }
}

/* ========== PREVIEW EDITABLE MODE ========== */

let _previewInputListener = null;

function _initPreviewEditing() {
    const preview = document.getElementById('markdownPreview');
    if (!preview) return;

    // Remove any previously attached listener
    if (_previewInputListener) {
        preview.removeEventListener('input', _previewInputListener);
    }

    _previewInputListener = function() {
        _previewEditing = true;
        // Debounce: sync to editor 800ms after user stops typing
        if (_previewSyncTimer) clearTimeout(_previewSyncTimer);
        _previewSyncTimer = setTimeout(() => {
            _syncPreviewToEditor();
            _previewEditing = false;
        }, 800);
    };

    preview.addEventListener('input', _previewInputListener);
}

function _syncPreviewToEditor() {
    const preview = document.getElementById('markdownPreview');
    if (!preview || !editor) return;
    // Extract plain text from the contenteditable preview
    const text = preview.innerText || '';
    const cursor = editor.getCursor();
    editor.setValue(text);
    // Attempt to restore cursor position
    try { editor.setCursor(cursor); } catch(e) {}
    hasUnsavedChanges = true;
    // Trigger autosave
    if (typeof resetAutoSaveTimer === 'function') resetAutoSaveTimer();
}

/* ========== EDITOR SYNTAX HIGHLIGHTING ========== */

function getEditorPlainText() {
    if (!editor) return '';
    return editor.getValue();
}

/* ========== HIGHLIGHT ENGINE ========== */

// Tracks active CodeMirror text markers for highlights
let activeHighlightMarkers = [];
// Currently selected highlight color
let currentHighlightColor = '#ffe26a';

function toggleHighlightPicker(event) {
    event.stopPropagation();
    const popover = document.getElementById('highlightPopover');
    const isOpen = popover.classList.contains('open');
    closeHighlightPicker();
    if (!isOpen) {
        // Position below the trigger button using fixed coords
        const btn = document.getElementById('highlightTriggerBtn');
        const rect = btn.getBoundingClientRect();
        popover.style.top = (rect.bottom + 6) + 'px';
        popover.style.left = (rect.left + rect.width / 2) + 'px';
        popover.style.transform = 'translateX(-50%)';
        popover.classList.add('open');
        setTimeout(() => {
            document.addEventListener('click', closeHighlightPickerOnOutsideClick, { once: true });
        }, 0);
    }
}

function closeHighlightPickerOnOutsideClick(e) {
    const wrapper = document.getElementById('highlightPickerWrapper');
    if (!wrapper.contains(e.target)) {
        closeHighlightPicker();
    } else {
        // Re-attach if click was inside but didn't close
        document.addEventListener('click', closeHighlightPickerOnOutsideClick, { once: true });
    }
}

function closeHighlightPicker() {
    document.getElementById('highlightPopover').classList.remove('open');
}

function setHighlightColor(color) {
    currentHighlightColor = color;
    const swatch = document.getElementById('highlightColorSwatch');
    if (swatch) swatch.style.background = color;
}

function applyHighlight(color) {
    closeHighlightPicker();
    setHighlightColor(color);
    if (!editor || !currentNoteId) return;
    
    const doc = editor.getDoc();
    const from = doc.getCursor('from');
    const to = doc.getCursor('to');
    
    // Must have a selection
    if (from.line === to.line && from.ch === to.ch) {
        showToast('Select text to highlight');
        return;
    }
    
    const note = notes.find(n => n.id === currentNoteId);
    if (!note) return;
    if (!note.highlights) note.highlights = [];
    
    const fromIndex = doc.indexFromPos(from);
    const toIndex = doc.indexFromPos(to);
    const rawText = doc.getSelection();
    const renderedText = markdownToPlainText(rawText);
    
    // Remove any existing highlights that overlap this range
    note.highlights = note.highlights.filter(h => h.to <= fromIndex || h.from >= toIndex);
    
    // Store indices (for editor markers) + text (for preview matching)
    note.highlights.push({ from: fromIndex, to: toIndex, text: rawText, previewText: renderedText, color });
    
    saveNote(note);
    applyHighlightMarkers(note);
    updatePreview();
    hasUnsavedChanges = true;
}

// Strip markdown syntax to get the plain text that the preview renderer will produce
function markdownToPlainText(md) {
    if (!md) return '';
    const html = marked.parse(md);
    const tmp = document.createElement('div');
    tmp.innerHTML = DOMPurify.sanitize(html);
    return tmp.textContent || tmp.innerText || '';
}

function removeHighlight() {
    closeHighlightPicker();
    if (!editor || !currentNoteId) return;
    
    const note = notes.find(n => n.id === currentNoteId);
    if (!note || !note.highlights) return;
    
    // Sync live marker positions before filtering so we use current positions
    syncHighlightPositionsFromMarkers(note);
    
    const doc = editor.getDoc();
    const from = doc.getCursor('from');
    const to = doc.getCursor('to');
    const fromIndex = doc.indexFromPos(from);
    const toIndex = doc.indexFromPos(to);
    const selectionIsPoint = from.line === to.line && from.ch === to.ch;
    
    if (selectionIsPoint) {
        note.highlights = note.highlights.filter(h => !(h.from <= fromIndex && h.to >= fromIndex));
    } else {
        note.highlights = note.highlights.filter(h => h.to <= fromIndex || h.from >= toIndex);
    }
    
    saveNote(note);
    applyHighlightMarkers(note);
    updatePreview();
    hasUnsavedChanges = true;
    showToast('Highlight removed');
}

function applyHighlightMarkers(note) {
    if (!editor) return;
    
    // Clear existing markers
    activeHighlightMarkers.forEach(m => m.marker.clear());
    activeHighlightMarkers = [];
    
    if (!note.highlights || note.highlights.length === 0) return;
    
    const doc = editor.getDoc();
    const contentLength = doc.getValue().length;
    
    note.highlights.forEach((h) => {
        // Guard against stale highlights beyond content bounds
        if (h.from >= contentLength || h.to > contentLength || h.from >= h.to) return;
        
        const from = doc.posFromIndex(h.from);
        const to = doc.posFromIndex(h.to);
        
        ensureHighlightColorClass(h.color);
        
        const marker = doc.markText(from, to, {
            className: `cm-highlight cm-highlight-${colorToClass(h.color)}`,
            inclusiveLeft: false,
            inclusiveRight: false
        });
        // Store the highlight object reference directly so sync never uses stale indices
        activeHighlightMarkers.push({ marker, highlight: h });
    });
}

// Read current marker positions back into note.highlights before switching away.
// CodeMirror adjusts marker ranges as the document is edited — this captures those updates.
function syncHighlightPositionsFromMarkers(note) {
    if (!editor || !note || !note.highlights) return;
    const doc = editor.getDoc();
    
    activeHighlightMarkers.forEach(({ marker, highlight }) => {
        const range = marker.find();
        if (!range) return; // marker was cleared/deleted
        highlight.from = doc.indexFromPos(range.from);
        highlight.to   = doc.indexFromPos(range.to);
    });
}

// Inject a <style> rule for a highlight color class if not already done
const _injectedHighlightClasses = new Set();
function ensureHighlightColorClass(color) {
    const cls = colorToClass(color);
    if (_injectedHighlightClasses.has(cls)) return;
    _injectedHighlightClasses.add(cls);
    const style = document.createElement('style');
    style.textContent = `.cm-highlight-${cls} { background: ${color}; border-radius: 2px; }`;
    document.head.appendChild(style);
}

function colorToClass(color) {
    return color.replace('#', 'hl');
}

// Apply highlights to the rendered preview by matching the stored previewText strings
function applyHighlightsToPreview(container, highlights) {
    if (!highlights || highlights.length === 0) return;

    // Use previewText if available, otherwise strip markdown from raw text as fallback
    const sorted = [...highlights]
        .map(h => ({
            ...h,
            matchText: (h.previewText && h.previewText.trim()) ? h.previewText.trim()
                     : (h.text ? markdownToPlainText(h.text).trim() : '')
        }))
        .filter(h => h.matchText.length > 0)
        .sort((a, b) => b.matchText.length - a.matchText.length);

    for (const h of sorted) {
        highlightTextInContainer(container, h.matchText, h.color);
    }
}

// Walk text nodes in container and wrap all occurrences of `searchText` with a <mark>
function highlightTextInContainer(container, searchText, color) {
    // Collect text nodes fresh each call (prior calls may have split nodes)
    const textNodes = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
        textNodes.push(node);
    }

    for (const textNode of textNodes) {
        const idx = textNode.textContent.indexOf(searchText);
        if (idx === -1) continue;

        const before = textNode.textContent.slice(0, idx);
        const after = textNode.textContent.slice(idx + searchText.length);

        const mark = document.createElement('mark');
        mark.style.background = color;
        mark.style.borderRadius = '2px';
        mark.style.padding = '0 1px';
        mark.textContent = searchText;

        const frag = document.createDocumentFragment();
        if (before) frag.appendChild(document.createTextNode(before));
        frag.appendChild(mark);
        if (after) frag.appendChild(document.createTextNode(after));

        textNode.parentNode.replaceChild(frag, textNode);
        // Only replace first occurrence per node per highlight; walker already moved on
    }
}

/* ========== UI RENDERING ========== */

function renderFileExplorer() {
    const explorer = document.getElementById('fileExplorer');
    explorer.innerHTML = '';
    
    // Add drag and drop listeners to the explorer itself for dropping at root
    explorer.addEventListener('dragover', handleRootDragOver);
    explorer.addEventListener('drop', handleRootDrop);
    
    // Render folders hierarchically
    renderFolderTree(null, explorer);
    
    // Render root notes (no folder), sorted by order
    const rootNotes = notes.filter(n => !n.folderId).sort((a, b) => (a.order || 0) - (b.order || 0));
    rootNotes.forEach(note => {
        const noteEl = createNoteElement(note, false);
        explorer.appendChild(noteEl);
    });
}

function renderFolderTree(parentFolderId, container) {
    // Get folders at this level, sorted by order
    const childFolders = folders
        .filter(f => f.parentFolderId === parentFolderId)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
    
    childFolders.forEach(folder => {
        const folderEl = createFolderElement(folder);
        container.appendChild(folderEl);
        
        if (!folder.collapsed) {
            // Render subfolders
            renderFolderTree(folder.id, container);
            
            // Render notes in this folder, sorted by order
            const folderNotes = notes.filter(n => n.folderId === folder.id).sort((a, b) => (a.order || 0) - (b.order || 0));
            folderNotes.forEach(note => {
                const noteEl = createNoteElement(note, true, folder.id);
                container.appendChild(noteEl);
            });
        }
    });
}

function getFolderDepth(folderId) {
    let depth = 0;
    let currentFolder = folders.find(f => f.id === folderId);
    
    while (currentFolder && currentFolder.parentFolderId) {
        depth++;
        currentFolder = folders.find(f => f.id === currentFolder.parentFolderId);
    }
    
    return depth;
}

function createFolderElement(folder) {
    const div = document.createElement('div');
    div.className = 'folder-item';
    div.setAttribute('data-folder-id', folder.id);
    div.setAttribute('draggable', 'true');
    
    // Add indentation for nested folders
    if (folder.parentFolderId) {
        const depth = getFolderDepth(folder.id);
        div.style.marginLeft = (depth * 20) + 'px';
    }
    
    // Drag and drop event listeners
    div.setAttribute('draggable', 'false');
    div.addEventListener('dragstart', handleDragStart);
    div.addEventListener('dragend', handleDragEnd);
    div.addEventListener('dragover', handleDragOver);
    div.addEventListener('dragleave', handleDragLeave);
    div.addEventListener('drop', handleDrop);

    // Drag handle — only this enables dragging
    const dragHandle = document.createElement('span');
    dragHandle.className = 'drag-handle';
    dragHandle.textContent = '⠿';
    dragHandle.title = 'Drag to reorder';
    dragHandle.addEventListener('mouseenter', () => div.setAttribute('draggable', 'true'));
    dragHandle.addEventListener('mouseleave', () => div.setAttribute('draggable', 'false'));

    const toggle = document.createElement('span');
    toggle.className = `folder-toggle ${folder.collapsed ? '' : 'open'}`;
    toggle.textContent = '▶';
    toggle.onclick = (e) => {
        e.stopPropagation();
        toggleFolder(folder.id);
    };
    // Prevent drag from starting when clicking the toggle
    toggle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });
    toggle.addEventListener('dragstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = '📁';
    icon.style.cursor = 'pointer';
    icon.addEventListener('mousedown', (e) => e.stopPropagation());
    icon.addEventListener('dragstart', (e) => { e.preventDefault(); e.stopPropagation(); });
    icon.onclick = (e) => { e.stopPropagation(); toggleFolder(folder.id); };

    const name = document.createElement('span');
    name.className = 'item-name';
    name.textContent = folder.name;
    name.title = folder.name;
    name.style.cursor = 'pointer';
    name.addEventListener('mousedown', (e) => e.stopPropagation());
    name.addEventListener('dragstart', (e) => { e.preventDefault(); e.stopPropagation(); });
    name.onclick = (e) => { e.stopPropagation(); toggleFolder(folder.id); };
    
    // Ellipsis button to show context menu
    const ellipsisBtn = document.createElement('button');
    ellipsisBtn.className = 'item-ellipsis-btn';
    ellipsisBtn.textContent = '⋯';
    ellipsisBtn.title = 'More actions';
    ellipsisBtn.onclick = (e) => {
        e.stopPropagation();
        
        // Close any other open context menus
        document.querySelectorAll('.item-actions.show').forEach(menu => {
            menu.classList.remove('show');
        });
        
        const actions = div.querySelector('.item-actions');
        actions.classList.toggle('show');
        
        // Position the context menu
        const rect = ellipsisBtn.getBoundingClientRect();
        actions.style.top = (rect.bottom + 5) + 'px';
        actions.style.left = (rect.left - 140) + 'px';
    };
    // Prevent drag from starting when clicking ellipsis
    ellipsisBtn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });
    ellipsisBtn.addEventListener('dragstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    // Prevent drag from starting on the actions menu
    actions.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });
    actions.addEventListener('dragstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    actions.innerHTML = `
        <button class="item-action-btn" onclick="event.stopPropagation(); createSubfolder('${folder.id}'); closeContextMenus();">
            <span>📁</span> New Subfolder
        </button>
        <button class="item-action-btn" onclick="event.stopPropagation(); createNoteInFolder('${folder.id}'); closeContextMenus();">
            <span>📄</span> New Note
        </button>
        <button class="item-action-btn" onclick="event.stopPropagation(); renameItem('folder', '${folder.id}', '${folder.name.replace(/'/g, "\\'")}'); closeContextMenus();">
            <span>✏️</span> Rename
        </button>
        <button class="item-action-btn" onclick="event.stopPropagation(); deleteFolderById('${folder.id}'); closeContextMenus();">
            <span>🗑️</span> Delete
        </button>
    `;
    
    div.appendChild(dragHandle);
    div.appendChild(toggle);
    div.appendChild(icon);
    div.appendChild(name);
    div.appendChild(ellipsisBtn);
    div.appendChild(actions);
    
    return div;
}

function createNoteElement(note, inFolder, folderId) {
    const div = document.createElement('div');
    div.className = `file-item ${currentNoteId === note.id ? 'active' : ''}`;
    div.setAttribute('data-note-id', note.id);
    div.setAttribute('draggable', 'false');
    
    // Add indentation for notes in folders
    if (inFolder && folderId) {
        const depth = getFolderDepth(folderId);
        div.style.marginLeft = ((depth + 1) * 20) + 'px';
    }
    
    div.onclick = () => openNote(note.id);
    
    // Drag and drop event listeners
    div.addEventListener('dragstart', handleDragStart);
    div.addEventListener('dragend', handleDragEnd);
    div.addEventListener('dragover', handleDragOver);
    div.addEventListener('dragleave', handleDragLeave);
    div.addEventListener('drop', handleDrop);

    // Drag handle — only this enables dragging
    const noteDragHandle = document.createElement('span');
    noteDragHandle.className = 'drag-handle';
    noteDragHandle.textContent = '⠿';
    noteDragHandle.title = 'Drag to reorder';
    noteDragHandle.addEventListener('mouseenter', () => div.setAttribute('draggable', 'true'));
    noteDragHandle.addEventListener('mouseleave', () => div.setAttribute('draggable', 'false'));
    
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = '📄';
    
    const name = document.createElement('span');
    name.className = 'item-name';
    name.textContent = note.title;
    name.title = note.title;
    
    // Ellipsis button to show context menu
    const ellipsisBtn = document.createElement('button');
    ellipsisBtn.className = 'item-ellipsis-btn';
    ellipsisBtn.textContent = '⋯';
    ellipsisBtn.title = 'More actions';
    ellipsisBtn.onclick = (e) => {
        e.stopPropagation();
        
        // Close any other open context menus
        document.querySelectorAll('.item-actions.show').forEach(menu => {
            menu.classList.remove('show');
        });
        
        const actions = div.querySelector('.item-actions');
        actions.classList.toggle('show');
        
        // Position the context menu
        const rect = ellipsisBtn.getBoundingClientRect();
        actions.style.top = (rect.bottom + 5) + 'px';
        actions.style.left = (rect.left - 140) + 'px';
    };
    // Prevent drag from starting when clicking ellipsis
    ellipsisBtn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });
    ellipsisBtn.addEventListener('dragstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    // Prevent drag from starting on the actions menu
    actions.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });
    actions.addEventListener('dragstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    actions.innerHTML = `
        <button class="item-action-btn" onclick="event.stopPropagation(); duplicateNote('${note.id}'); closeContextMenus();">
            <span>📋</span> Duplicate
        </button>
        <button class="item-action-btn" onclick="event.stopPropagation(); renameItem('note', '${note.id}', '${note.title.replace(/'/g, "\\'")}'); closeContextMenus();">
            <span>✏️</span> Rename
        </button>
        <button class="item-action-btn" onclick="event.stopPropagation(); deleteNoteById('${note.id}'); closeContextMenus();">
            <span>🗑️</span> Delete
        </button>
    `;
    
    div.appendChild(noteDragHandle);
    div.appendChild(icon);
    div.appendChild(name);
    div.appendChild(ellipsisBtn);
    div.appendChild(actions);
    
    return div;
}

function updateActiveNote() {
    document.querySelectorAll('.file-item').forEach(el => {
        el.classList.remove('active');
    });
    
    if (currentNoteId) {
        const activeEl = document.querySelector(`[data-note-id="${currentNoteId}"]`);
        if (activeEl) {
            activeEl.classList.add('active');
        }
    }
}

function closeContextMenus() {
    document.querySelectorAll('.item-actions.show').forEach(menu => {
        menu.classList.remove('show');
    });
}

function updateBreadcrumb(note) {
    const breadcrumb = document.getElementById('breadcrumb');
    breadcrumb.innerHTML = '';
    
    if (note.folderId) {
        const folder = folders.find(f => f.id === note.folderId);
        if (folder) {
            const folderCrumb = document.createElement('span');
            folderCrumb.className = 'breadcrumb-item';
            folderCrumb.textContent = folder.name;
            breadcrumb.appendChild(folderCrumb);
        }
    }
    
    const noteCrumb = document.createElement('span');
    noteCrumb.className = 'breadcrumb-item breadcrumb-title-editable';
    noteCrumb.textContent = note.title;
    noteCrumb.title = 'Click to rename';
    noteCrumb.setAttribute('data-note-id', note.id);

    noteCrumb.addEventListener('click', () => {
        startInlineTitleEdit(noteCrumb, note);
    });

    breadcrumb.appendChild(noteCrumb);
}

function measureTextWidth(text, el) {
    const canvas = measureTextWidth._canvas || (measureTextWidth._canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    const style = window.getComputedStyle(el);
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return ctx.measureText(text).width;
}

function startInlineTitleEdit(crumbEl, note) {
    if (crumbEl.querySelector('input')) return; // already editing

    const currentTitle = note.title;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentTitle;
    input.className = 'breadcrumb-title-input';

    crumbEl.textContent = '';
    crumbEl.appendChild(input);

    function resizeInput() {
        const textWidth = measureTextWidth(input.value || ' ', input);
        const padding = 20; // account for input padding + border
        const maxWidth = (crumbEl.closest('.breadcrumb')?.offsetWidth || 400) - 20;
        input.style.width = Math.min(textWidth + padding, maxWidth) + 'px';
    }

    // Size immediately, then again after fonts settle
    resizeInput();
    requestAnimationFrame(resizeInput);

    input.addEventListener('input', resizeInput);
    input.focus();
    input.select();

    async function commitRename() {
        const newName = input.value.trim();
        if (newName && newName !== currentTitle) {
            note.title = newName;
            note.modified = new Date().toISOString();
            await saveNote(note);
            if (openTabs.includes(note.id)) renderTabs();
            renderFileExplorer();
            showToast('Note renamed');
        }
        // Re-render breadcrumb with latest note data
        const freshNote = notes.find(n => n.id === note.id) || note;
        updateBreadcrumb(freshNote);
    }

    input.addEventListener('blur', commitRename);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = currentTitle; input.blur(); }
    });
}

function updateRightSidebar(note) {
    console.log('=== updateRightSidebar called ===');
    console.log('Note title:', note.title);
    console.log('Note tags:', note.tags);
    console.log('Note links:', note.links);
    console.log('Note content length:', note.content?.length || 0);
    
    // Update metadata
    const createdDateEl = document.getElementById('createdDate');
    const modifiedDateEl = document.getElementById('modifiedDate');
    const wordCountEl = document.getElementById('wordCount');
    
    console.log('Metadata elements found:', {
        createdDate: !!createdDateEl,
        modifiedDate: !!modifiedDateEl,
        wordCount: !!wordCountEl
    });
    
    if (createdDateEl) createdDateEl.textContent = formatDate(note.created);
    if (modifiedDateEl) modifiedDateEl.textContent = formatDate(note.modified);
    if (wordCountEl) wordCountEl.textContent = countWords(note.content);
    
    // Update table of contents
    updateTableOfContents(note);
    
    // Update tags
    const tagsContainer = document.getElementById('noteTags');
    console.log('Tags container found:', !!tagsContainer);
    if (tagsContainer) {
        if (note.tags && note.tags.length > 0) {
            console.log('Setting tags HTML for', note.tags.length, 'tags');
            tagsContainer.innerHTML = note.tags.map(tag => 
                `<div class="tag-item" onclick="searchByTag('${tag}')">#${tag}</div>`
            ).join('');
        } else {
            console.log('No tags, showing empty message');
            tagsContainer.innerHTML = '<span class="empty-message">No tags</span>';
        }
    }
    
    // Update outgoing links
    const linksContainer = document.getElementById('outgoingLinks');
    console.log('Links container found:', !!linksContainer);
    if (linksContainer) {
        if (note.links && note.links.length > 0) {
            console.log('Setting links HTML for', note.links.length, 'links');
            linksContainer.innerHTML = note.links.map(link => {
                const linkedNote = notes.find(n => 
                    n.title.toLowerCase() === link.toLowerCase()
                );
                const className = linkedNote ? 'link-item' : 'link-item broken';
                const onclick = linkedNote ? `onclick="openNote('${linkedNote.id}')"` : '';
                return `<div class="${className}" ${onclick}>[[${link}]]</div>`;
            }).join('');
        } else {
            console.log('No links, showing empty message');
            linksContainer.innerHTML = '<span class="empty-message">No links</span>';
        }
    }
    
    // Update backlinks
    const backlinksContainer = document.getElementById('backlinks');
    console.log('Backlinks container found:', !!backlinksContainer);
    const backlinks = notes.filter(n => 
        n.links && n.links.some(link => 
            link.toLowerCase() === note.title.toLowerCase()
        )
    );
    
    console.log('Found', backlinks.length, 'backlinks');
    
    if (backlinksContainer) {
        if (backlinks.length > 0) {
            backlinksContainer.innerHTML = backlinks.map(n => 
                `<div class="link-item" onclick="openNote('${n.id}')">${n.title}</div>`
            ).join('');
        } else {
            backlinksContainer.innerHTML = '<span class="empty-message">No backlinks</span>';
        }
    }
     else {
        backlinksContainer.innerHTML = '<span class="empty-message">No backlinks</span>';
    }
    
    console.log('=== updateRightSidebar complete ===');
}
 
/* ========== EDITOR MODES ========== */

function insertFormatting(type) {
    if (!editor) return;
    
    const doc = editor.getDoc();
    const cursor = doc.getCursor();
    const selection = doc.getSelection();
    
    let newText = '';
    
    switch(type) {
        case 'bold':
            newText = `**${selection || 'bold text'}**`;
            break;
        case 'italic':
            newText = `*${selection || 'italic text'}*`;
            break;
        case 'strikethrough':
            newText = `~~${selection || 'strikethrough text'}~~`;
            break;
        case 'h1':
            newText = `# ${selection || 'Heading 1'}`;
            break;
        case 'h2':
            newText = `## ${selection || 'Heading 2'}`;
            break;
        case 'h3':
            newText = `### ${selection || 'Heading 3'}`;
            break;
        case 'link':
            newText = `[${selection || 'link text'}](url)`;
            break;
        case 'wikilink':
            newText = `[[${selection || 'Note Name'}]]`;
            break;
        case 'code':
            newText = `\`${selection || 'code'}\``;
            break;
        case 'codeblock':
            newText = `\`\`\`\n${selection || 'code'}\n\`\`\``;
            break;
        case 'quote':
            newText = `> ${selection || 'quote'}`;
            break;
        case 'ul':
            newText = `- ${selection || 'list item'}`;
            break;
        case 'ol':
            newText = `1. ${selection || 'list item'}`;
            break;
        case 'task':
            newText = `- [ ] ${selection || 'task'}`;
            break;
        case 'hr':
            newText = '\n---\n';
            break;
        case 'table':
            newText = '\n| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |\n';
            break;
    }
    
    // Replace selection with formatted text
    doc.replaceSelection(newText);
    
    // Focus the editor
    editor.focus();
    
    // Trigger change event for auto-save
    hasUnsavedChanges = true;
    updatePreview();
    resetAutoSaveTimer();
}

function switchEditorTab(eventOrMode, mode) {
    // Handle both old signature (mode only) and new signature (event, mode)
    let actualMode;
    if (typeof eventOrMode === 'string') {
        actualMode = eventOrMode;
    } else {
        const event = eventOrMode;
        actualMode = mode;
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
    }

    const previousMode = currentEditMode;
    currentEditMode = actualMode;

    const editPane = document.getElementById('editPane');
    const previewPane = document.getElementById('previewPane');
    const container = document.getElementById('editorContainer');

    // Update view mode buttons
    document.querySelectorAll('.view-mode-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-mode') === actualMode) {
            btn.classList.add('active');
        }
    });

    // Capture scroll fraction BEFORE switching visibility
    let scrollFraction = 0;
    if (previousMode === 'edit' || previousMode === 'split') {
        scrollFraction = getEditorScrollFraction();
    } else if (previousMode === 'preview') {
        scrollFraction = getPreviewScrollFraction();
    }

    // Manage contenteditable state on markdownPreview
    const markdownPreview = document.getElementById('markdownPreview');

    if (actualMode === 'edit') {
        // Flush any pending preview edits before switching away
        if (_previewEditing && _previewSyncTimer) {
            clearTimeout(_previewSyncTimer);
            _syncPreviewToEditor();
        }
        _previewEditing = false;
        if (markdownPreview) {
            markdownPreview.contentEditable = 'false';
            markdownPreview.classList.remove('preview-editable');
        }
        editPane.style.display = 'flex';
        previewPane.style.display = 'none';
        container.classList.remove('split-view');
        splitScrollSyncOff();
        if (editor) {
            setTimeout(() => {
                editor.refresh();
                applyEditorScrollFraction(scrollFraction);
                if (searchState.query) performSearch();
            }, 10);
        }
    } else if (actualMode === 'preview') {
        if (markdownPreview) {
            markdownPreview.contentEditable = 'true';
            markdownPreview.classList.add('preview-editable');
        }
        editPane.style.display = 'none';
        previewPane.style.display = 'block';
        container.classList.remove('split-view');
        splitScrollSyncOff();
        _previewEditing = false;
        updatePreview();
        _initPreviewEditing();
        setTimeout(() => {
            applyPreviewScrollFraction(scrollFraction);
            if (searchState.query) performSearch();
        }, 20);
    } else if (actualMode === 'split') {
        // Split mode: read-only preview
        _previewEditing = false;
        if (markdownPreview) {
            markdownPreview.contentEditable = 'false';
            markdownPreview.classList.remove('preview-editable');
        }
        editPane.style.display = 'flex';
        previewPane.style.display = 'block';
        container.classList.add('split-view');
        updatePreview();
        if (editor) {
            setTimeout(() => {
                editor.refresh();
                // Sync preview to match editor on entering split
                const frac = getEditorScrollFraction();
                applyPreviewScrollFraction(frac);
                splitScrollSyncOn();
            }, 20);
        }
    }
}

function toggleEditMode() {
    const modes = ['edit', 'preview', 'split'];
    const currentIndex = modes.indexOf(currentEditMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    switchEditorTab(nextMode);
}

/* ========== SCROLL SYNC ========== */

// Returns 0..1 fraction of how far through the document the editor cursor/scroll is
function getEditorScrollFraction() {
    if (!editor) return 0;
    const info = editor.getScrollInfo();
    if (info.height <= info.clientHeight) return 0;
    return info.top / (info.height - info.clientHeight);
}

function getPreviewScrollFraction() {
    const pane = document.getElementById('previewPane');
    if (!pane) return 0;
    const max = pane.scrollHeight - pane.clientHeight;
    if (max <= 0) return 0;
    return pane.scrollTop / max;
}

function applyEditorScrollFraction(fraction) {
    if (!editor) return;
    const info = editor.getScrollInfo();
    const max = info.height - info.clientHeight;
    if (max <= 0) return;
    editor.scrollTo(null, fraction * max);
}

function applyPreviewScrollFraction(fraction) {
    const pane = document.getElementById('previewPane');
    if (!pane) return;
    const max = pane.scrollHeight - pane.clientHeight;
    if (max <= 0) return;
    pane.scrollTop = fraction * max;
}

// Split-mode: keep the two panes scroll-synced in real time
let _splitSyncActive = false;
let _syncingFromEditor = false;
let _syncingFromPreview = false;

function splitScrollSyncOn() {
    if (_splitSyncActive) return;
    _splitSyncActive = true;

    if (editor) {
        editor.on('scroll', _onEditorScroll);
    }
    const previewPane = document.getElementById('previewPane');
    if (previewPane) {
        previewPane.addEventListener('scroll', _onPreviewScroll);
    }
}

function splitScrollSyncOff() {
    _splitSyncActive = false;
    if (editor) editor.off('scroll', _onEditorScroll);
    const previewPane = document.getElementById('previewPane');
    if (previewPane) previewPane.removeEventListener('scroll', _onPreviewScroll);
}

function _onEditorScroll() {
    if (_syncingFromPreview) return;
    _syncingFromEditor = true;
    applyPreviewScrollFraction(getEditorScrollFraction());
    requestAnimationFrame(() => { _syncingFromEditor = false; });
}

function _onPreviewScroll() {
    if (_syncingFromEditor) return;
    _syncingFromPreview = true;
    applyEditorScrollFraction(getPreviewScrollFraction());
    requestAnimationFrame(() => { _syncingFromPreview = false; });
}

/* ========== SEARCH ========== */

function searchNotes() {
    const query = document.getElementById('searchInput').value.toLowerCase();
    
    if (!query) {
        renderFileExplorer();
        return;
    }
    
    const results = notes.filter(note => 
        note.title.toLowerCase().includes(query) ||
        note.content.toLowerCase().includes(query) ||
        (note.tags && note.tags.some(tag => tag.toLowerCase().includes(query)))
    );
    
    const explorer = document.getElementById('fileExplorer');
    explorer.innerHTML = '';
    
    if (results.length === 0) {
        explorer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-tertiary);">No results found</div>';
        return;
    }
    
    results.forEach(note => {
        const noteEl = createNoteElement(note, false);
        explorer.appendChild(noteEl);
    });
}

function searchByTag(tag) {
    document.getElementById('searchInput').value = '#' + tag;
    searchNotes();
}

/* ========== SETTINGS ========== */

function openSettingsModal() {
    document.getElementById('settingsModal').classList.add('active');
}

function closeSettingsModal() {
    document.getElementById('settingsModal').classList.remove('active');
}

function changeTheme() {
    const theme = document.getElementById('themeSelect').value;
    settings.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    
    // Update CodeMirror theme and refresh to apply theme colors
    if (editor) {
        editor.setOption('theme', getCodeMirrorTheme());
        editor.refresh();
    }
    
    saveSettings();
    showToast('Theme changed');
}

function changeFontFamily() {
    const fontFamily = document.getElementById('fontFamilySelect').value;
    settings.fontFamily = fontFamily;
    applyFontFamily(fontFamily);
    saveSettings();
    showToast('Font changed');
}

function applyFontFamily(fontFamily) {
    const preview = document.getElementById('markdownPreview');
    
    let fontStack;
    switch(fontFamily) {
        case 'monospace':
            fontStack = "'Consolas', 'Monaco', 'Courier New', monospace";
            break;
        case 'sans-serif':
            fontStack = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif";
            break;
        case 'serif':
            fontStack = "'Georgia', 'Times New Roman', serif";
            break;
        case 'courier':
            fontStack = "'Courier New', Courier, monospace";
            break;
        case 'consolas':
            fontStack = "'Consolas', 'Monaco', monospace";
            break;
        case 'monaco':
            fontStack = "'Monaco', 'Consolas', monospace";
            break;
        case 'georgia':
            fontStack = "'Georgia', serif";
            break;
        case 'times':
            fontStack = "'Times New Roman', Times, serif";
            break;
        case 'arial':
            fontStack = "'Arial', sans-serif";
            break;
        case 'verdana':
            fontStack = "'Verdana', sans-serif";
            break;
        case 'comic':
            fontStack = "'Comic Sans MS', cursive";
            break;
        default:
            fontStack = "'Consolas', 'Monaco', 'Courier New', monospace";
    }
    
    // Set CSS variable for editor font (applies to CodeMirror)
    document.documentElement.style.setProperty('--editor-font', fontStack);
    
    // Apply to preview
    preview.style.fontFamily = fontStack;
    
    // Refresh CodeMirror to pick up the new font
    if (editor) {
        editor.refresh();
    }
}

function changeFontSize(size) {
    if (!size) {
        size = document.getElementById('fontSizeRange').value;
    }
    settings.fontSize = parseInt(size);
    document.getElementById('fontSizeValue').textContent = size + 'px';
    
    // Set CSS variable for editor font size (applies to CodeMirror)
    document.documentElement.style.setProperty('--editor-font-size', size + 'px');
    
    // Apply to preview
    document.getElementById('markdownPreview').style.fontSize = size + 'px';
    
    // Refresh CodeMirror to pick up the new font size
    if (editor) {
        editor.refresh();
    }
    
    saveSettings();
}

function toggleAutoSave() {
    settings.autoSave = document.getElementById('autoSaveCheckbox').checked;
    saveSettings();
    showToast(settings.autoSave ? 'Auto-save enabled' : 'Auto-save disabled');
}

function toggleVimMode() {
    settings.vimMode = document.getElementById('vimModeCheckbox').checked;
    saveSettings();
    showToast('Vim mode is a planned feature');
}

/* ========== IMPORT/EXPORT ========== */

function exportVault() {
    const data = {
        notes: notes,
        folders: folders,
        exportDate: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `storyroot-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('Vault exported successfully');
}

async function importVault(file) {
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            
            if (data.notes) {
                for (const note of data.notes) {
                    await saveNote(note);
                }
                notes = await loadNotes();
            }
            
            if (data.folders) {
                for (const folder of data.folders) {
                    await saveFolder(folder);
                }
                folders = await loadFolders();
            }
            
            renderFileExplorer();
            showToast('Vault imported successfully');
        } catch (error) {
            console.error('Import error:', error);
            showToast('Failed to import vault');
        }
    };
    reader.readAsText(file);
}

async function clearAllData() {
    if (!confirm('Are you sure you want to delete ALL notes and folders? This cannot be undone!')) {
        return;
    }
    
    // Clear all notes
    for (const note of notes) {
        await deleteNote(note.id);
    }
    notes = [];
    
    // Clear all folders
    for (const folder of folders) {
        await deleteFolder(folder.id);
    }
    folders = [];
    
    currentNoteId = null;
    if (editor) { editor.setValue(''); };
    
    renderFileExplorer();
    showEmptyState();
    closeSettingsModal();
    showToast('All data cleared');
}

/* ========== RENAME & DELETE MODALS ========== */

function renameItem(type, id, currentName) {
    renameTarget = { type, id };
    openRenameModal(currentName);
}

function openRenameModal(currentName) {
    const modal = document.getElementById('renameModal');
    const input = document.getElementById('renameInput');
    const confirmBtn = document.getElementById('renameConfirmBtn');
    const modalTitle = document.getElementById('renameModalTitle');
    
    input.value = currentName;
    
    // Update title and button text based on whether we're creating or renaming
    if (isCreating) {
        if (renameTarget && renameTarget.type === 'folder') {
            modalTitle.textContent = 'Create Folder';
        } else {
            modalTitle.textContent = 'Create Note';
        }
        confirmBtn.textContent = 'Create';
    } else {
        modalTitle.textContent = 'Rename';
        confirmBtn.textContent = 'Rename';
    }
    
    modal.classList.add('active');
    setTimeout(() => input.select(), 100);
}

function closeRenameModal() {
    document.getElementById('renameModal').classList.remove('active');
    renameTarget = null;
    isCreating = false; // Reset creation flag
}

async function confirmRename() {
    if (!renameTarget) return;
    
    const newName = document.getElementById('renameInput').value.trim();
    if (!newName) {
        showToast('Name cannot be empty');
        return;
    }
    
    if (renameTarget.type === 'note') {
        const note = notes.find(n => n.id === renameTarget.id);
        if (note) {
            note.title = newName;
            note.modified = new Date().toISOString();
            await saveNote(note);
            
            if (currentNoteId === note.id) {
                updateBreadcrumb(note);
            }
            
            // Update tab if note is open
            if (openTabs.includes(note.id)) {
                renderTabs();
            }
        }
    } else if (renameTarget.type === 'folder') {
        const folder = folders.find(f => f.id === renameTarget.id);
        if (folder) {
            folder.name = newName;
            await saveFolder(folder);
        }
    }
    
    renderFileExplorer();
    closeRenameModal();
    showToast('Renamed successfully');
    isCreating = false; // Reset creation flag
}

function openDeleteModal() {
    document.getElementById('deleteModal').classList.add('active');
}

function closeDeleteModal() {
    document.getElementById('deleteModal').classList.remove('active');
    deleteTarget = null;
}

/* ========== SIDEBAR TOGGLES ========== */

function toggleLeftSidebar() {
    const sidebar = document.getElementById('leftSidebar');
    sidebar.classList.toggle('collapsed');
}

function toggleRightSidebar() {
    const sidebar = document.getElementById('rightSidebar');
    sidebar.classList.toggle('collapsed');
}

/* ========== DISTRACTION-FREE MODE ========== */

let _dfLeftWasCollapsed = false;
let _dfRightWasCollapsed = false;

function toggleDistractionFree() {
    if (document.body.classList.contains('distraction-free')) {
        exitDistractionFree();
    } else {
        enterDistractionFree();
    }
}

function enterDistractionFree() {
    const leftSidebar = document.getElementById('leftSidebar');
    const rightSidebar = document.getElementById('rightSidebar');

    // Remember current sidebar states
    _dfLeftWasCollapsed = leftSidebar.classList.contains('collapsed');
    _dfRightWasCollapsed = rightSidebar.classList.contains('collapsed');

    // Collapse both sidebars
    leftSidebar.classList.add('collapsed');
    rightSidebar.classList.add('collapsed');

    document.body.classList.add('distraction-free');

    // Update button title
    const btn = document.getElementById('distractionFreeBtn');
    if (btn) btn.title = 'Exit Distraction-Free (Esc or F11)';

    // Seed the stats badge immediately
    updateDFStats();

    // Refresh editor so CodeMirror reflows to new size
    if (editor) setTimeout(() => editor.refresh(), 50);
}

function exitDistractionFree() {
    const leftSidebar = document.getElementById('leftSidebar');
    const rightSidebar = document.getElementById('rightSidebar');

    document.body.classList.remove('distraction-free');

    // Restore sidebar states
    if (!_dfLeftWasCollapsed) leftSidebar.classList.remove('collapsed');
    if (!_dfRightWasCollapsed) rightSidebar.classList.remove('collapsed');

    const btn = document.getElementById('distractionFreeBtn');
    if (btn) btn.title = 'Distraction-Free Mode (F11)';

    if (editor) setTimeout(() => editor.refresh(), 50);
}

function updateDFStats() {
    const badge = document.getElementById('dfStatsBadge');
    if (!badge) return;

    const text = editor ? editor.getValue() : '';

    const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).filter(w => w.length > 0).length;
    const chars = text.length;
    const lines = text === '' ? 0 : text.split('\n').length;
    const readTime = Math.max(1, Math.round(words / 200)); // ~200 wpm

    document.getElementById('dfWords').textContent = words.toLocaleString();
    document.getElementById('dfChars').textContent = chars.toLocaleString();
    document.getElementById('dfLines').textContent = lines.toLocaleString();
    document.getElementById('dfReadTime').textContent = readTime;
}

window.toggleDistractionFree = toggleDistractionFree;
window.exitDistractionFree = exitDistractionFree;

/* ========== UTILITY FUNCTIONS ========== */

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

function countWords(text) {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function showEmptyState() {
    document.getElementById('emptyState').classList.add('visible');
    document.getElementById('editorContainer').style.display = 'none';
}

function hideEmptyState() {
    document.getElementById('emptyState').classList.remove('visible');
    document.getElementById('editorContainer').style.display = 'flex';
}

function resetAutoSaveTimer() {
    if (!settings.autoSave) return;
    
    if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
    }
    
    autoSaveTimer = setTimeout(() => {
        if (hasUnsavedChanges && currentNoteId) {
            saveCurrentNote();
        }
    }, 3000); // Auto-save after 3 seconds of inactivity
}

/* ========== TABLE OF CONTENTS ========== */

function updateTableOfContents(note) {
    const tocContainer = document.getElementById('tableOfContents');
    
    if (!note || !note.content) {
        tocContainer.innerHTML = '<span class="empty-message">No headers</span>';
        return;
    }
    
    // Parse headers from markdown content
    const headers = parseHeaders(note.content);
    
    if (headers.length === 0) {
        tocContainer.innerHTML = '<span class="empty-message">No headers</span>';
        return;
    }
    
    // Build table of contents HTML
    tocContainer.innerHTML = '';
    headers.forEach((header, index) => {
        const tocItem = document.createElement('div');
        tocItem.className = `toc-item level-${header.level}`;
        tocItem.textContent = header.text;
        tocItem.dataset.headerId = `header-${index}`;
        
        // Click handler to scroll to header in preview
        tocItem.addEventListener('click', () => {
            scrollToHeader(index);
        });
        
        tocContainer.appendChild(tocItem);
    });
}

function parseHeaders(markdown) {
    const headers = [];
    const lines = markdown.split('\n');
    
    lines.forEach((line, lineNumber) => {
        // Match markdown headers (# Header)
        const match = line.match(/^(#{1,6})\s+(.+)$/);
        if (match) {
            const level = match[1].length; // Number of # symbols
            const text = match[2].trim();
            headers.push({ level, text, lineNumber });
        }
    });
    
    return headers;
}

function scrollToHeader(headerIndex) {
    const editor = document.getElementById('markdownEditor');
    const preview = document.getElementById('markdownPreview');
    const note = notes.find(n => n.id === currentNoteId);
    
    if (!note) return;
    
    // Parse headers to get line numbers
    const headers = parseHeaders(note.content);
    const header = headers[headerIndex];
    
    if (!header) return;
    
    // Scroll and highlight in markdown editor
    scrollToLineInEditor(editor, header.lineNumber);
    
    // Scroll and highlight in preview (only if preview is visible)
    if (currentEditMode !== 'edit') {
        const previewHeaders = preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
        
        if (previewHeaders[headerIndex]) {
            previewHeaders[headerIndex].scrollIntoView({ 
                behavior: 'smooth', 
                block: 'start'
            });
            
            // Highlight the header briefly in preview
            previewHeaders[headerIndex].style.backgroundColor = 'var(--accent-primary)';
            previewHeaders[headerIndex].style.color = 'white';
            previewHeaders[headerIndex].style.padding = '4px 8px';
            previewHeaders[headerIndex].style.borderRadius = '4px';
            previewHeaders[headerIndex].style.transition = 'all 0.3s';
            
            setTimeout(() => {
                previewHeaders[headerIndex].style.backgroundColor = '';
                previewHeaders[headerIndex].style.color = '';
                previewHeaders[headerIndex].style.padding = '';
            }, 1000);
        }
    }
}

function scrollToLineInEditor(editorInstance, lineNumber) {
    if (!editor) return;
    
    const doc = editor.getDoc();
    const totalLines = doc.lineCount();
    
    // Make sure line number is valid
    if (lineNumber >= totalLines) return;
    
    // Scroll to the line
    const coords = editor.charCoords({line: lineNumber, ch: 0}, 'local');
    editor.scrollTo(null, coords.top - editor.getScrollInfo().clientHeight / 3);
    
    // Set cursor at the end of the line
    const lineContent = doc.getLine(lineNumber);
    doc.setCursor({line: lineNumber, ch: lineContent.length});
    
    // Focus the editor
    editor.focus();
}

/* ========== UTILITY FUNCTIONS ========== */

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Handle modal clicks
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        if (e.target.id === 'renameModal') closeRenameModal();
        if (e.target.id === 'deleteModal') closeDeleteModal();
        if (e.target.id === 'settingsModal') closeSettingsModal();
    }
});

// Handle Enter key in rename modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.getElementById('renameModal').classList.contains('active')) {
        confirmRename();
    }
});

// Export functions to window for onclick handlers
window.createNewNote = createNewNote;
window.createNewFolder = createNewFolder;
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.exportVault = exportVault;
window.importVault = importVault;
window.clearAllData = clearAllData;
window.searchNotes = searchNotes;
window.toggleLeftSidebar = toggleLeftSidebar;
window.toggleRightSidebar = toggleRightSidebar;
window.openNote = openNote;
window.closeTab = closeTab;
window.saveCurrentNote = saveCurrentNote;
window.deleteNoteById = deleteNoteById;
window.duplicateNote = duplicateNote;
window.createSubfolder = createSubfolder;
window.createNoteInFolder = createNoteInFolder;
window.toggleFolder = toggleFolder;
window.deleteFolderById = deleteFolderById;
window.renameItem = renameItem;
window.openRenameModal = openRenameModal;
window.closeRenameModal = closeRenameModal;
window.confirmRename = confirmRename;
window.openDeleteModal = openDeleteModal;
window.closeDeleteModal = closeDeleteModal;
window.confirmDelete = confirmDelete;
window.insertFormatting = insertFormatting;
window.switchEditorTab = switchEditorTab;
window.toggleEditMode = toggleEditMode;
window.changeTheme = changeTheme;
window.changeFontFamily = changeFontFamily;
window.changeFontSize = changeFontSize;
window.toggleAutoSave = toggleAutoSave;
window.toggleVimMode = toggleVimMode;
window.searchByTag = searchByTag;

/* ========== SEARCH AND REPLACE ========== */

function updateNoteInMemory() {
    if (!currentNoteId || !editor) return;
    const note = notes.find(n => n.id === currentNoteId);
    if (!note) return;
    note.content = editor.getValue();
    note.modified = new Date().toISOString();
    note.tags = extractTags(note.content);
    note.links = extractLinks(note.content);
    updatePreview();
    resetAutoSaveTimer();
}

// Search state
let searchState = {
    query: '',
    replaceText: '',
    matches: [],
    currentMatchIndex: -1,
    matchCase: false,
    wholeWord: false,
    useRegex: false,
    markers: [],
    _previewFlatText: '',
    _previewNodeMap: null
};

function openSearchPanel(showReplace = false) {
    const panel = document.getElementById('searchReplacePanel');
    const replaceRow = document.getElementById('replaceRow');
    const replaceToggleBtn = document.getElementById('replaceToggleBtn');
    const searchInput = document.getElementById('searchTextInput');
    
    panel.classList.add('active');
    
    if (showReplace) {
        replaceRow.style.display = 'flex';
        replaceToggleBtn.classList.add('active');
    } else {
        replaceRow.style.display = 'none';
        replaceToggleBtn.classList.remove('active');
    }
    
    // Focus search input and select any existing text
    setTimeout(() => {
        searchInput.focus();
        searchInput.select();
    }, 100);
    
    // If there's selected text in the editor, use it as search query
    if (editor) {
        const selection = editor.getSelection();
        if (selection) {
            searchInput.value = selection;
            performSearch();
        }
    }
}

function toggleReplaceRow() {
    const replaceRow = document.getElementById('replaceRow');
    const replaceToggleBtn = document.getElementById('replaceToggleBtn');
    
    if (replaceRow.style.display === 'none') {
        replaceRow.style.display = 'flex';
        replaceToggleBtn.classList.add('active');
        // Focus the replace input
        setTimeout(() => {
            document.getElementById('replaceTextInput').focus();
        }, 100);
    } else {
        replaceRow.style.display = 'none';
        replaceToggleBtn.classList.remove('active');
    }
}

function closeSearchPanel() {
    const panel = document.getElementById('searchReplacePanel');
    panel.classList.remove('active');
    
    // Clear input fields
    const searchInput = document.getElementById('searchTextInput');
    const replaceInput = document.getElementById('replaceTextInput');
    if (searchInput) searchInput.value = '';
    if (replaceInput) replaceInput.value = '';
    
    // Reset query state and clear all highlights
    searchState.query = '';
    searchState.replaceText = '';
    clearSearchHighlights();
    updateSearchCount();
}

function toggleMatchCase() {
    searchState.matchCase = !searchState.matchCase;
    const btn = document.getElementById('matchCaseBtn');
    btn.classList.toggle('active');
    if (searchState.query) {
        performSearch();
    }
}

function toggleWholeWord() {
    searchState.wholeWord = !searchState.wholeWord;
    const btn = document.getElementById('wholeWordBtn');
    btn.classList.toggle('active');
    if (searchState.query) {
        performSearch();
    }
}

function toggleRegex() {
    searchState.useRegex = !searchState.useRegex;
    const btn = document.getElementById('regexBtn');
    btn.classList.toggle('active');
    if (searchState.query) {
        performSearch();
    }
}

function performSearch() {
    const searchInput = document.getElementById('searchTextInput');
    searchState.query = searchInput.value;
    
    clearSearchHighlights();
    
    if (!searchState.query) {
        updateSearchCount();
        return;
    }

    // Build search pattern
    let pattern;
    try {
        if (searchState.useRegex) {
            pattern = new RegExp(searchState.query, searchState.matchCase ? 'g' : 'gi');
        } else {
            let escapedQuery = searchState.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (searchState.wholeWord) {
                escapedQuery = '\\b' + escapedQuery + '\\b';
            }
            pattern = new RegExp(escapedQuery, searchState.matchCase ? 'g' : 'gi');
        }
    } catch (e) {
        updateSearchCount();
        return;
    }

    if (currentEditMode === 'preview') {
        _performSearchInPreview(pattern);
    } else {
        _performSearchInEditor(pattern);
    }
}

function _performSearchInEditor(pattern) {
    if (!editor) return;
    const doc = editor.getDoc();
    const content = doc.getValue();
    
    searchState.matches = [];
    let match;
    while ((match = pattern.exec(content)) !== null) {
        const pos = doc.posFromIndex(match.index);
        const endPos = doc.posFromIndex(match.index + match[0].length);
        searchState.matches.push({ from: pos, to: endPos, text: match[0] });
        if (match.index === pattern.lastIndex) pattern.lastIndex++;
    }
    
    if (searchState.matches.length > 0 && searchState.currentMatchIndex === -1) {
        searchState.currentMatchIndex = 0;
    }
    if (searchState.currentMatchIndex >= searchState.matches.length) {
        searchState.currentMatchIndex = searchState.matches.length > 0 ? 0 : -1;
    }
    
    highlightMatchesOnly();
    updateSearchCount();
}

function _performSearchInPreview(pattern) {
    const preview = document.getElementById('markdownPreview');
    if (!preview) { updateSearchCount(); return; }

    // Collect all text nodes
    const textNodes = [];
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);

    // Build flat text + offset map
    let flatText = '';
    const nodeMap = []; // {node, start, end}
    for (const tn of textNodes) {
        const start = flatText.length;
        flatText += tn.textContent;
        nodeMap.push({ node: tn, start, end: start + tn.textContent.length });
    }

    // Find matches
    searchState.matches = [];
    searchState._previewFlatText = flatText;
    searchState._previewNodeMap = nodeMap;
    let match;
    while ((match = pattern.exec(flatText)) !== null) {
        searchState.matches.push({ index: match.index, length: match[0].length, text: match[0] });
        if (match.index === pattern.lastIndex) pattern.lastIndex++;
    }

    if (searchState.matches.length > 0 && searchState.currentMatchIndex === -1) {
        searchState.currentMatchIndex = 0;
    }
    if (searchState.currentMatchIndex >= searchState.matches.length) {
        searchState.currentMatchIndex = searchState.matches.length > 0 ? 0 : -1;
    }

    _highlightPreviewMatches();
    updateSearchCount();
}

function _highlightPreviewMatches() {
    // Re-render preview to clear old highlights, then apply new ones
    const preview = document.getElementById('markdownPreview');
    if (!preview || !searchState._previewNodeMap) return;

    // Wrap each match in a <mark> span
    // Re-collect text nodes after potential DOM changes
    _clearPreviewHighlights();

    const nodeMap = searchState._previewNodeMap;
    if (!nodeMap) return;

    // Apply marks in reverse order to preserve offsets
    const matches = [...searchState.matches];
    for (let mi = matches.length - 1; mi >= 0; mi--) {
        const m = matches[mi];
        _wrapPreviewMatch(m.index, m.length, mi === searchState.currentMatchIndex, nodeMap);
    }
}

function _wrapPreviewMatch(flatIndex, length, isCurrent, nodeMap) {
    // Find the text node containing flatIndex
    const startNode = nodeMap.find(n => flatIndex >= n.start && flatIndex < n.end);
    if (!startNode) return;

    const localOffset = flatIndex - startNode.start;
    const tn = startNode.node;
    if (!tn.parentNode) return;

    const before = tn.textContent.slice(0, localOffset);
    const matchText = tn.textContent.slice(localOffset, localOffset + Math.min(length, tn.textContent.length - localOffset));
    const after = tn.textContent.slice(localOffset + matchText.length);

    const mark = document.createElement('mark');
    mark.className = 'preview-search-match' + (isCurrent ? ' current' : '');
    mark.textContent = matchText;

    const frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));
    frag.appendChild(mark);
    if (after) frag.appendChild(document.createTextNode(after));

    tn.parentNode.replaceChild(frag, tn);

    // Update the node map for subsequent calls (since we replaced the node)
    startNode.node = mark.nextSibling || mark; // point to after text
}

function _clearPreviewHighlights() {
    const preview = document.getElementById('markdownPreview');
    if (!preview) return;
    const marks = preview.querySelectorAll('mark.preview-search-match');
    marks.forEach(mark => {
        const parent = mark.parentNode;
        if (parent) {
            parent.replaceChild(document.createTextNode(mark.textContent), mark);
            parent.normalize();
        }
    });
    // Rebuild node map after clearing
    const textNodes = [];
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, null);
    let node;
    let flatText = '';
    const nodeMap = [];
    while ((node = walker.nextNode())) {
        const start = flatText.length;
        flatText += node.textContent;
        nodeMap.push({ node, start, end: start + node.textContent.length });
        textNodes.push(node);
    }
    searchState._previewFlatText = flatText;
    searchState._previewNodeMap = nodeMap;
}

function highlightMatchesOnly() {
    if (!editor) return;
    
    const doc = editor.getDoc();
    
    searchState.matches.forEach((match, index) => {
        const marker = doc.markText(match.from, match.to, {
            className: index === searchState.currentMatchIndex ? 'CodeMirror-search-match current' : 'CodeMirror-search-match'
        });
        searchState.markers.push(marker);
    });
}

function clearSearchHighlights() {
    // Clear editor markers
    searchState.markers.forEach(marker => marker.clear());
    searchState.markers = [];
    searchState.matches = [];
    searchState.currentMatchIndex = -1;
    // Clear preview highlights
    const preview = document.getElementById('markdownPreview');
    if (preview) {
        const marks = preview.querySelectorAll('mark.preview-search-match');
        marks.forEach(mark => {
            const parent = mark.parentNode;
            if (parent) {
                parent.replaceChild(document.createTextNode(mark.textContent), mark);
                parent.normalize();
            }
        });
    }
    searchState._previewFlatText = '';
    searchState._previewNodeMap = null;
}

function updateSearchCount() {
    const countEl = document.getElementById('searchCount');
    if (searchState.matches.length === 0) {
        countEl.textContent = '0/0';
    } else {
        countEl.textContent = `${searchState.currentMatchIndex + 1}/${searchState.matches.length}`;
    }
}

function jumpToMatch(index) {
    if (searchState.matches.length === 0) return;
    searchState.currentMatchIndex = index;
    
    if (currentEditMode === 'preview') {
        // Re-render highlights with new current
        _highlightPreviewMatches();
        // Scroll the current mark into view
        const preview = document.getElementById('markdownPreview');
        if (preview) {
            const current = preview.querySelector('mark.preview-search-match.current');
            if (current) current.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    } else {
        if (!editor) return;
        // Update marker classes
        searchState.markers.forEach((marker, i) => {
            marker.clear();
            const match = searchState.matches[i];
            const className = i === index ? 'CodeMirror-search-match current' : 'CodeMirror-search-match';
            searchState.markers[i] = editor.getDoc().markText(match.from, match.to, { className });
        });
        const match = searchState.matches[index];
        editor.scrollIntoView(match.from, 100);
        editor.setSelection(match.from, match.to);
        editor.focus();
    }
    
    updateSearchCount();
}

function findNext() {
    if (searchState.matches.length === 0) {
        // Only perform search if we don't have matches yet
        performSearch();
        if (searchState.matches.length === 0) return;
    }
    
    const nextIndex = (searchState.currentMatchIndex + 1) % searchState.matches.length;
    jumpToMatch(nextIndex);
}

function findPrevious() {
    if (searchState.matches.length === 0) {
        // Only perform search if we don't have matches yet
        performSearch();
        if (searchState.matches.length === 0) return;
    }
    
    const prevIndex = searchState.currentMatchIndex - 1 < 0 
        ? searchState.matches.length - 1 
        : searchState.currentMatchIndex - 1;
    jumpToMatch(prevIndex);
}

function replaceOne() {
    if (currentEditMode === 'preview') {
        // In preview mode, switch to edit mode, do replacement, switch back
        _replaceInEditorContent(false);
        return;
    }
    if (!editor || searchState.currentMatchIndex < 0) return;
    
    const replaceInput = document.getElementById('replaceTextInput');
    searchState.replaceText = replaceInput.value;
    
    const doc = editor.getDoc();
    const match = searchState.matches[searchState.currentMatchIndex];
    
    doc.replaceRange(searchState.replaceText, match.from, match.to);
    hasUnsavedChanges = true;
    updateNoteInMemory();
    performSearch();
}

function replaceAll() {
    if (currentEditMode === 'preview') {
        _replaceInEditorContent(true);
        return;
    }
    if (!editor || searchState.matches.length === 0) return;
    
    const replaceInput = document.getElementById('replaceTextInput');
    searchState.replaceText = replaceInput.value;
    
    const doc = editor.getDoc();
    const replacementCount = searchState.matches.length;
    
    for (let i = searchState.matches.length - 1; i >= 0; i--) {
        const match = searchState.matches[i];
        doc.replaceRange(searchState.replaceText, match.from, match.to);
    }
    
    hasUnsavedChanges = true;
    updateNoteInMemory();
    clearSearchHighlights();
    searchState.query = '';
    updateSearchCount();
    
    showToast(`Replaced ${replacementCount} occurrence${replacementCount !== 1 ? 's' : ''}`);
}

function _replaceInEditorContent(replaceAll) {
    // For preview mode: perform replacements on the underlying editor content
    if (!editor || !searchState.query) return;
    const replaceInput = document.getElementById('replaceTextInput');
    const replaceText = replaceInput.value;
    
    let pattern;
    try {
        if (searchState.useRegex) {
            pattern = new RegExp(searchState.query, (searchState.matchCase ? 'g' : 'gi'));
        } else {
            let q = searchState.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (searchState.wholeWord) q = '\\b' + q + '\\b';
            pattern = new RegExp(q, searchState.matchCase ? 'g' : 'gi');
        }
    } catch(e) { return; }

    const content = editor.getValue();
    let count = 0;
    let newContent;
    if (replaceAll) {
        newContent = content.replace(pattern, () => { count++; return replaceText; });
    } else {
        // Replace first match after currentMatchIndex (use match index from flat preview text)
        let matchIdx = 0;
        newContent = content.replace(pattern, (m) => {
            if (matchIdx++ === Math.max(0, searchState.currentMatchIndex)) {
                count++;
                return replaceText;
            }
            return m;
        });
    }
    
    if (count > 0) {
        _settingEditorValue = true;
        editor.setValue(newContent);
        _settingEditorValue = false;
        hasUnsavedChanges = true;
        updateNoteInMemory();
        updatePreview();
        // Re-run search after preview updates
        setTimeout(() => performSearch(), 50);
        if (replaceAll) showToast(`Replaced ${count} occurrence${count !== 1 ? 's' : ''}`);
    }
}

// Event listeners for search input
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchTextInput');
    const replaceInput = document.getElementById('replaceTextInput');
    
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            performSearch();
        });
        
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) {
                    findPrevious();
                } else {
                    findNext();
                }
            } else if (e.key === 'Escape') {
                closeSearchPanel();
            }
        });
    }
    
    if (replaceInput) {
        replaceInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) {
                    replaceAll();
                } else {
                    replaceOne();
                }
            } else if (e.key === 'Escape') {
                closeSearchPanel();
            }
        });
    }
});

// Export search functions
window.openSearchPanel = openSearchPanel;
window.closeSearchPanel = closeSearchPanel;
window.toggleReplaceRow = toggleReplaceRow;
window.toggleMatchCase = toggleMatchCase;
window.toggleWholeWord = toggleWholeWord;
window.toggleRegex = toggleRegex;
window.findNext = findNext;
window.findPrevious = findPrevious;
window.replaceOne = replaceOne;
window.replaceAll = replaceAll;

// Export highlight functions
window.toggleHighlightPicker = toggleHighlightPicker;
window.applyHighlight = applyHighlight;
window.removeHighlight = removeHighlight;
