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

    // Apply saved font size
    if (settings.fontSize) {
        const editor = document.getElementById('markdownEditor');
        const preview = document.getElementById('markdownPreview');
        const highlights = document.getElementById('editorHighlights');
        editor.style.fontSize = settings.fontSize + 'px';
        preview.style.fontSize = settings.fontSize + 'px';
        if (highlights) highlights.style.fontSize = settings.fontSize + 'px';
        
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

    // Setup event listeners
    const editor = document.getElementById('markdownEditor');
    
    // Handle input events for contenteditable
    editor.addEventListener('input', () => {
        hasUnsavedChanges = true;
        if (currentNoteId) {
            updatePreview();
            // DON'T call styleEditorHeaders here - it causes cursor issues
            resetAutoSaveTimer();
        }
    });
    
    //Handle keyboard events
    editor.addEventListener('keydown', (e) => {
        // Re-style only on Enter key (new line)
        if (e.key === 'Enter') {
            setTimeout(() => styleEditorHeaders(), 0);
        }
    });
    
    // Style headers on load
    styleEditorHeaders();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
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
        
        // Ctrl+F or Cmd+F to search
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            document.getElementById('searchInput').focus();
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

/* ========== NOTE MANAGEMENT ========== */

function createNewNote() {
    const note = {
        id: generateId(),
        title: 'Untitled Note',
        content: '',
        folderId: null,
        tags: [],
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
            renameTarget = { type: 'note', id: note.id };
            openRenameModal(note.title);
        }
    }, 100);
}

function openNote(noteId) {
    const note = notes.find(n => n.id === noteId);
    if (!note) return;

    // Add to tabs if not already open
    if (!openTabs.includes(noteId)) {
        openTabs.push(noteId);
        renderTabs();
    }
    
    currentNoteId = noteId;
    hasUnsavedChanges = false;
    
    // Update editor
    const editor = document.getElementById('markdownEditor');
    editor.textContent = note.content || '';
    
    // Update UI
    hideEmptyState();
    updateBreadcrumb(note);
    updatePreview();
    styleEditorHeaders();
    updateRightSidebar(note);
    updateActiveNote();
    renderTabs(); // Update tab highlighting
    
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
            <span class="note-tab-close" onclick="closeTab('${noteId}', event)">×</span>
        `;
        
        tab.onclick = (e) => {
            if (!e.target.classList.contains('note-tab-close')) {
                switchToTab(noteId);
            }
        };
        
        tabsBar.appendChild(tab);
    });
}

function switchToTab(noteId) {
    if (currentNoteId === noteId) return;
    
    // Save current note before switching
    if (currentNoteId && settings.autoSave) {
        saveCurrentNote();
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
            document.getElementById('markdownEditor').textContent = '';
            showEmptyState();
        }
    }
    
    renderTabs();
}

async function saveCurrentNote() {
    if (!currentNoteId) return;
    
    const note = notes.find(n => n.id === currentNoteId);
    if (!note) return;
    
    const editor = document.getElementById('markdownEditor');
    note.content = getEditorPlainText();
    note.modified = new Date().toISOString();
    
    // Extract tags and links
    note.tags = extractTags(note.content);
    note.links = extractLinks(note.content);
    
    await saveNote(note);
    hasUnsavedChanges = false;
    
    // Update UI
    updateRightSidebar(note);
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
                document.getElementById('markdownEditor').textContent = '';
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
        collapsed: false
    };
    
    folders.push(folder);
    saveFolder(folder);
    renderFileExplorer();
    
    // Focus on folder for renaming
    setTimeout(() => {
        renameTarget = { type: 'folder', id: folder.id };
        openRenameModal(folder.name);
    }, 100);
}

function createSubfolder(parentFolderId) {
    const folder = {
        id: generateId(),
        name: 'New Folder',
        parentFolderId: parentFolderId,
        collapsed: false
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

function updatePreview() {
    if (currentEditMode === 'edit') return;
    
    const editor = document.getElementById('markdownEditor');
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
    
    // Update table of contents
    if (currentNoteId) {
        const note = notes.find(n => n.id === currentNoteId);
        if (note) {
            // Create a temporary note object with current content for TOC update
            updateTableOfContents({ ...note, content: getEditorPlainText() });
        }
    }
}

/* ========== EDITOR SYNTAX HIGHLIGHTING ========== */

function getEditorPlainText() {
    const editor = document.getElementById('markdownEditor');
    if (!editor) return '';
    
    // Get plain text from the div structure
    // Each line is wrapped in a div, so we need to join them with newlines
    const divs = editor.querySelectorAll('div');
    if (divs.length > 0) {
        return Array.from(divs).map(div => div.textContent).join('\n');
    }
    
    // Fallback to textContent
    return editor.textContent || '';
}

function styleEditorHeaders() {
    const editor = document.getElementById('markdownEditor');
    if (!editor) return;
    
    // Don't re-style if we're in the middle of typing
    // This prevents cursor jumping
    const text = getEditorPlainText();
    
    // Apply CSS-based styling by analyzing each line
    // We'll use a simple approach: wrap the content in divs with inline styles
    const lines = text.split('\n');
    
    // Store selection before modifying
    const selection = window.getSelection();
    let savedSelection = null;
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        savedSelection = {
            startContainer: range.startContainer,
            startOffset: range.startOffset,
            endContainer: range.endContainer,
            endOffset: range.endOffset
        };
    }
    
    // Build new HTML with styled lines
    const newHTML = lines.map((line, index) => {
        const headerMatch = line.match(/^(#{1,6})\s+/);
        if (headerMatch) {
            return `<div style="font-weight: bold;">${escapeHtml(line)}</div>`;
        }
        return `<div>${escapeHtml(line) || '<br>'}</div>`;
    }).join('');
    
    // Only update if content structure changed
    const currentText = getEditorPlainText();
    if (currentText !== text || editor.children.length !== lines.length) {
        editor.innerHTML = newHTML;
        
        // Restore selection if possible
        if (savedSelection) {
            try {
                const newRange = document.createRange();
                const newSelection = window.getSelection();
                // This is a simplified restoration - for production you'd want more robust handling
                newRange.setStart(editor.firstChild || editor, 0);
                newRange.collapse(true);
                newSelection.removeAllRanges();
                newSelection.addRange(newRange);
            } catch (e) {
                // Selection restoration failed, ignore
            }
        }
    }
}

/* ========== UI RENDERING ========== */

function renderFileExplorer() {
    const explorer = document.getElementById('fileExplorer');
    explorer.innerHTML = '';
    
    // Render folders hierarchically
    renderFolderTree(null, explorer);
    
    // Render root notes (no folder)
    const rootNotes = notes.filter(n => !n.folderId);
    rootNotes.forEach(note => {
        const noteEl = createNoteElement(note, false);
        explorer.appendChild(noteEl);
    });
}

function renderFolderTree(parentFolderId, container) {
    // Get folders at this level
    const childFolders = folders.filter(f => f.parentFolderId === parentFolderId);
    
    childFolders.forEach(folder => {
        const folderEl = createFolderElement(folder);
        container.appendChild(folderEl);
        
        if (!folder.collapsed) {
            // Render subfolders
            renderFolderTree(folder.id, container);
            
            // Render notes in this folder
            const folderNotes = notes.filter(n => n.folderId === folder.id);
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
    
    // Add indentation for nested folders
    if (folder.parentFolderId) {
        const depth = getFolderDepth(folder.id);
        div.style.marginLeft = (depth * 20) + 'px';
    }
    
    const toggle = document.createElement('span');
    toggle.className = `folder-toggle ${folder.collapsed ? '' : 'open'}`;
    toggle.textContent = '▶';
    toggle.onclick = (e) => {
        e.stopPropagation();
        toggleFolder(folder.id);
    };
    
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = '📁';
    
    const name = document.createElement('span');
    name.textContent = folder.name;
    
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    actions.innerHTML = `
        <button class="item-action-btn" onclick="event.stopPropagation(); createSubfolder('${folder.id}')" title="New Subfolder">📁+</button>
        <button class="item-action-btn" onclick="event.stopPropagation(); createNoteInFolder('${folder.id}')" title="New Note">➕</button>
        <button class="item-action-btn" onclick="event.stopPropagation(); renameItem('folder', '${folder.id}', '${folder.name}')" title="Rename">✏️</button>
        <button class="item-action-btn" onclick="event.stopPropagation(); deleteFolderById('${folder.id}')" title="Delete">🗑️</button>
    `;
    
    div.appendChild(toggle);
    div.appendChild(icon);
    div.appendChild(name);
    div.appendChild(actions);
    
    return div;
}

function createNoteElement(note, inFolder, folderId) {
    const div = document.createElement('div');
    div.className = `file-item ${currentNoteId === note.id ? 'active' : ''}`;
    div.setAttribute('data-note-id', note.id);
    
    // Add indentation for notes in folders
    if (inFolder && folderId) {
        const depth = getFolderDepth(folderId);
        div.style.marginLeft = ((depth + 1) * 20) + 'px';
    }
    
    div.onclick = () => openNote(note.id);
    
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = '📄';
    
    const name = document.createElement('span');
    name.textContent = note.title;
    
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    actions.innerHTML = `
        <button class="item-action-btn" onclick="event.stopPropagation(); duplicateNote('${note.id}')" title="Duplicate">📋</button>
        <button class="item-action-btn" onclick="event.stopPropagation(); renameItem('note', '${note.id}', '${note.title}')" title="Rename">✏️</button>
        <button class="item-action-btn" onclick="event.stopPropagation(); deleteNoteById('${note.id}')" title="Delete">🗑️</button>
    `;
    
    div.appendChild(icon);
    div.appendChild(name);
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
    noteCrumb.className = 'breadcrumb-item';
    noteCrumb.textContent = note.title;
    breadcrumb.appendChild(noteCrumb);
}

function updateRightSidebar(note) {
    // Update metadata
    document.getElementById('createdDate').textContent = formatDate(note.created);
    document.getElementById('modifiedDate').textContent = formatDate(note.modified);
    document.getElementById('wordCount').textContent = countWords(note.content);
    
    // Update table of contents
    updateTableOfContents(note);
    
    // Update tags
    const tagsContainer = document.getElementById('noteTags');
    if (note.tags && note.tags.length > 0) {
        tagsContainer.innerHTML = note.tags.map(tag => 
            `<div class="tag-item" onclick="searchByTag('${tag}')">#${tag}</div>`
        ).join('');
    } else {
        tagsContainer.innerHTML = '<span class="empty-message">No tags</span>';
    }
    
    // Update outgoing links
    const linksContainer = document.getElementById('outgoingLinks');
    if (note.links && note.links.length > 0) {
        linksContainer.innerHTML = note.links.map(link => {
            const linkedNote = notes.find(n => 
                n.title.toLowerCase() === link.toLowerCase()
            );
            const className = linkedNote ? 'link-item' : 'link-item broken';
            const onclick = linkedNote ? `onclick="openNote('${linkedNote.id}')"` : '';
            return `<div class="${className}" ${onclick}>[[${link}]]</div>`;
        }).join('');
    } else {
        linksContainer.innerHTML = '<span class="empty-message">No links</span>';
    }
    
    // Update backlinks
    const backlinksContainer = document.getElementById('backlinks');
    const backlinks = notes.filter(n => 
        n.links && n.links.some(link => 
            link.toLowerCase() === note.title.toLowerCase()
        )
    );
    
    if (backlinks.length > 0) {
        backlinksContainer.innerHTML = backlinks.map(n => 
            `<div class="link-item" onclick="openNote('${n.id}')">${n.title}</div>`
        ).join('');
    } else {
        backlinksContainer.innerHTML = '<span class="empty-message">No backlinks</span>';
    }
}

/* ========== EDITOR MODES ========== */

function insertFormatting(type) {
    const editor = document.getElementById('markdownEditor');
    editor.focus();
    
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    const selectedText = range.toString();
    
    let newText = '';
    
    switch(type) {
        case 'bold':
            newText = `**${selectedText || 'bold text'}**`;
            break;
        case 'italic':
            newText = `*${selectedText || 'italic text'}*`;
            break;
        case 'strikethrough':
            newText = `~~${selectedText || 'strikethrough text'}~~`;
            break;
        case 'h1':
            newText = `# ${selectedText || 'Heading 1'}`;
            break;
        case 'h2':
            newText = `## ${selectedText || 'Heading 2'}`;
            break;
        case 'h3':
            newText = `### ${selectedText || 'Heading 3'}`;
            break;
        case 'link':
            newText = `[${selectedText || 'link text'}](url)`;
            break;
        case 'wikilink':
            newText = `[[${selectedText || 'Note Name'}]]`;
            break;
        case 'code':
            newText = `\`${selectedText || 'code'}\``;
            break;
        case 'codeblock':
            newText = `\`\`\`\n${selectedText || 'code'}\n\`\`\``;
            break;
        case 'quote':
            newText = `> ${selectedText || 'quote'}`;
            break;
        case 'ul':
            newText = `- ${selectedText || 'list item'}`;
            break;
        case 'ol':
            newText = `1. ${selectedText || 'list item'}`;
            break;
        case 'task':
            newText = `- [ ] ${selectedText || 'task'}`;
            break;
        case 'hr':
            newText = '\n---\n';
            break;
        case 'table':
            newText = '\n| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |\n';
            break;
    }
    
    // Insert the text
    range.deleteContents();
    const textNode = document.createTextNode(newText);
    range.insertNode(textNode);
    
    // Move cursor to end of inserted text
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(range);
    
    // Trigger change event for auto-save
    hasUnsavedChanges = true;
    updatePreview();
    resetAutoSaveTimer();
}

function switchEditorTab(mode) {
    currentEditMode = mode;
    
    const editPane = document.getElementById('editPane');
    const previewPane = document.getElementById('previewPane');
    const container = document.getElementById('editorContainer');
    
    // Update view mode buttons
    document.querySelectorAll('.view-mode-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-mode') === mode) {
            btn.classList.add('active');
        }
    });
    
    if (mode === 'edit') {
        editPane.style.display = 'flex';
        previewPane.style.display = 'none';
        container.classList.remove('split-view');
    } else if (mode === 'preview') {
        editPane.style.display = 'none';
        previewPane.style.display = 'block';
        container.classList.remove('split-view');
        updatePreview();
    } else if (mode === 'split') {
        editPane.style.display = 'flex';
        previewPane.style.display = 'block';
        container.classList.add('split-view');
        updatePreview();
    }
}

function toggleEditMode() {
    const modes = ['edit', 'preview', 'split'];
    const currentIndex = modes.indexOf(currentEditMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    switchEditorTab(nextMode);
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
    const editor = document.getElementById('markdownEditor');
    const preview = document.getElementById('markdownPreview');
    const highlights = document.getElementById('editorHighlights');
    
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
    
    editor.style.fontFamily = fontStack;
    preview.style.fontFamily = fontStack;
    if (highlights) highlights.style.fontFamily = fontStack;
}

function changeFontSize(size) {
    if (!size) {
        size = document.getElementById('fontSizeRange').value;
    }
    settings.fontSize = parseInt(size);
    document.getElementById('fontSizeValue').textContent = size + 'px';
    document.getElementById('markdownEditor').style.fontSize = size + 'px';
    document.getElementById('markdownPreview').style.fontSize = size + 'px';
    const highlights = document.getElementById('editorHighlights');
    if (highlights) highlights.style.fontSize = size + 'px';
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
    document.getElementById('markdownEditor').textContent = '';
    
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
    
    input.value = currentName;
    
    // Update button text based on whether we're creating or renaming
    if (currentName === 'New Folder' || currentName === 'Untitled Note') {
        confirmBtn.textContent = 'Create';
    } else {
        confirmBtn.textContent = 'Rename';
    }
    
    modal.classList.add('active');
    setTimeout(() => input.select(), 100);
}

function closeRenameModal() {
    document.getElementById('renameModal').classList.remove('active');
    renameTarget = null;
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

function scrollToLineInEditor(editor, lineNumber) {
    const text = getEditorPlainText();
    const lines = text.split('\n');
    
    // Focus editor first
    editor.focus();
    
    // Find the div element for this line (since we wrap each line in a div)
    const divs = editor.querySelectorAll('div');
    if (divs[lineNumber]) {
        // Scroll the target div into view
        divs[lineNumber].scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Highlight temporarily
        divs[lineNumber].style.background = 'var(--accent-primary)';
        divs[lineNumber].style.color = 'white';
        divs[lineNumber].style.padding = '2px 4px';
        divs[lineNumber].style.borderRadius = '3px';
        divs[lineNumber].style.transition = 'all 0.3s';
        
        // Place cursor at the end of the line
        const range = document.createRange();
        const selection = window.getSelection();
        
        // Get the last text node in the div
        const lastNode = divs[lineNumber].lastChild || divs[lineNumber];
        range.setStart(lastNode, lastNode.textContent ? lastNode.textContent.length : 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        
        // Remove highlight after a moment
        setTimeout(() => {
            divs[lineNumber].style.background = '';
            divs[lineNumber].style.color = '';
            divs[lineNumber].style.padding = '';
        }, 1000);
    }
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
