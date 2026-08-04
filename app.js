const STORAGE_KEYS = {
    currentUser: 'pkform_currentUser',
    authToken: 'pkform_authToken'
};

const app = {
    currentUser: null,
    authToken: null,
    forms: [],
    activeFormId: null,
    isEditing: false,
    tempFields: [],
    editingFieldIndex: null,
};

const elements = {
    authSection: document.getElementById('authSection'),
    dashboardSection: document.getElementById('dashboardSection'),
    builderSection: document.getElementById('builderSection'),
    formTitle: document.getElementById('formTitle'),
    formDescription: document.getElementById('formDescription'),
    formEmail: document.getElementById('formEmail'),
    fieldLabel: document.getElementById('fieldLabel'),
    fieldType: document.getElementById('fieldType'),
    fieldRequired: document.getElementById('fieldRequired'),
    addFieldBtn: document.getElementById('addFieldBtn'),
    fieldsList: document.getElementById('fieldsList'),
    formList: document.getElementById('formList'),
    builderTitle: document.getElementById('builderTitle'),
    formSaveBtn: document.getElementById('formSaveBtn'),
    formCancelBtn: document.getElementById('formCancelBtn'),
    successMessage: document.getElementById('successMessage'),
    errorMessage: document.getElementById('errorMessage'),
    currentUserLabel: document.getElementById('currentUserLabel'),
    authTabs: document.querySelectorAll('[data-auth-tab]'),
    loginForm: document.getElementById('loginForm'),
    signupForm: document.getElementById('signupForm'),
    formEditor: document.getElementById('formEditor'),
    previewTitle: document.getElementById('previewTitle'),
    previewDescription: document.getElementById('previewDescription'),
    previewFields: document.getElementById('previewFields'),
};

function loadFromStorage(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function saveToStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function clearMessages() {
    elements.successMessage.classList.remove('active');
    elements.errorMessage.classList.remove('active');
    elements.successMessage.textContent = '';
    elements.errorMessage.textContent = '';
}

function showMessage(type, text) {
    clearMessages();
    if (type === 'success') {
        elements.successMessage.classList.add('active');
        elements.successMessage.textContent = text;
    } else if (type === 'error') {
        elements.errorMessage.classList.add('active');
        elements.errorMessage.textContent = text;
    }
}

function saveAuthState() {
    saveToStorage(STORAGE_KEYS.currentUser, app.currentUser);
    saveToStorage(STORAGE_KEYS.authToken, app.authToken);
}

function clearAuthState() {
    app.currentUser = null;
    app.authToken = null;
    saveToStorage(STORAGE_KEYS.currentUser, null);
    saveToStorage(STORAGE_KEYS.authToken, null);
}

function createId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function fetchJson(url, options = {}) {
    const headers = options.headers || {};
    if (app.authToken) {
        headers.Authorization = `Bearer ${app.authToken}`;
    }
    const response = await fetch(url, { ...options, headers });
    const result = await response.json();
    if (!response.ok) {
        const errorMessage = result?.error || 'Server error';
        throw new Error(errorMessage);
    }
    return result;
}

function syncState() {
    app.currentUser = loadFromStorage(STORAGE_KEYS.currentUser, null);
    app.authToken = loadFromStorage(STORAGE_KEYS.authToken, null);
}

function renderView() {
    const signedIn = !!app.currentUser;
    elements.authSection.classList.toggle('hidden', signedIn);
    elements.dashboardSection.classList.toggle('hidden', !signedIn);
    elements.builderSection.classList.add('hidden');
    elements.currentUserLabel.textContent = app.currentUser ? app.currentUser.username : '';
    if (signedIn) {
        renderFormList();
    }
}

function switchAuthTab(event) {
    const selectedTab = event.target.dataset.authTab;
    const activeSection = document.querySelector('[data-auth-section].active');
    if (activeSection) {
        activeSection.classList.remove('active');
        activeSection.classList.add('hidden');
    }
    const targetSection = document.querySelector(`[data-auth-section="${selectedTab}"]`);
    targetSection?.classList.remove('hidden');
    targetSection?.classList.add('active');
    elements.authTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.authTab === selectedTab));
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[c]);
}

function renderFormList() {
    const forms = app.forms || [];
    elements.formList.innerHTML = '';
    if (forms.length === 0) {
        elements.formList.innerHTML = '<div class="form-card"><strong>No forms yet.</strong><p class="form-meta">Create a new form to start collecting responses. You will receive emails when your form is submitted.</p></div>';
        return;
    }
    forms.sort((a, b) => b.updatedAt - a.updatedAt).forEach((form) => {
        const card = document.createElement('div');
        card.className = 'form-card';
        const created = new Date(form.createdAt).toLocaleDateString();
        const updated = new Date(form.updatedAt).toLocaleDateString();
        card.innerHTML = `
            <strong>${escapeHtml(form.title)}</strong>
            <div class="form-meta">${escapeHtml(form.description || 'No description')}<br>
            Notify: ${escapeHtml(form.email)}<br>
            ${form.fields.length} field(s) • Created ${created} • Updated ${updated}</div>
            <div class="actions">
                <button class="secondary" data-action="open" data-id="${form.id}">Open form</button>
                <button class="secondary" data-action="edit" data-id="${form.id}">Edit</button>
                <button class="secondary" data-action="delete" data-id="${form.id}">Delete</button>
                <button class="secondary" data-action="link" data-id="${form.id}">Copy link</button>
            </div>
        `;
        elements.formList.appendChild(card);
    });
}

async function loadForms() {
    try {
        const forms = await fetchJson('/api/forms');
        app.forms = forms;
        renderView();
    } catch (error) {
        clearAuthState();
        showMessage('error', 'Unable to load forms. Please sign in again.');
        renderView();
    }
}

function renderFieldsEditor(fields = []) {
    elements.fieldsList.innerHTML = '';
    if (fields.length === 0) {
        elements.fieldsList.innerHTML = '<p style="color: #64748b;">No fields yet. Add fields to your form and preview the layout.</p>';
        elements.previewFields.innerHTML = '<p style="color: #64748b;">Add fields to see the preview.</p>';
        elements.previewTitle.textContent = elements.formTitle.value || 'Untitled form';
        elements.previewDescription.textContent = elements.formDescription.value || 'Form description goes here.';
        return;
    }
    fields.forEach((field, index) => {
        const row = document.createElement('div');
        row.className = 'form-field-row';
        row.innerHTML = `
            <div>
                <strong>${escapeHtml(field.label)}</strong>
                <div class="form-meta">${escapeHtml(field.type)} field ${field.required ? '• required' : ''}</div>
            </div>
            <div class="field-actions">
                <button class="small-button secondary" data-action="edit-field" data-index="${index}">Edit</button>
                <button class="small-button danger" data-action="delete-field" data-index="${index}">Remove</button>
            </div>
        `;
        elements.fieldsList.appendChild(row);
    });
    renderFormPreview(fields);
}

function renderFormPreview(fields) {
    elements.previewTitle.textContent = elements.formTitle.value || 'Untitled form';
    elements.previewDescription.textContent = elements.formDescription.value || 'Form description goes here.';
    elements.previewFields.innerHTML = '';
    fields.forEach((field) => {
        const fieldWrap = document.createElement('div');
        fieldWrap.className = 'preview-field';
        const label = document.createElement('label');
        label.textContent = field.label + (field.required ? ' *' : '');
        fieldWrap.appendChild(label);
        if (field.type === 'textarea') {
            const textarea = document.createElement('textarea');
            textarea.placeholder = field.label;
            textarea.disabled = true;
            fieldWrap.appendChild(textarea);
        } else {
            const input = document.createElement('input');
            input.type = field.type;
            input.placeholder = field.label;
            input.disabled = true;
            fieldWrap.appendChild(input);
        }
        elements.previewFields.appendChild(fieldWrap);
    });
}

function updatePreview() {
    const fields = app.tempFields || [];
    renderFormPreview(fields);
}

function addField() {
    const label = elements.fieldLabel.value.trim();
    const type = elements.fieldType.value;
    const required = elements.fieldRequired.checked;
    if (!label) {
        showMessage('error', 'Field label cannot be empty.');
        return;
    }
    app.tempFields.push({ id: createId(), label, type, required });
    elements.fieldLabel.value = '';
    elements.fieldType.value = 'text';
    elements.fieldRequired.checked = false;
    renderFieldsEditor(app.tempFields);
    clearMessages();
}

function openFieldEditor(index) {
    const field = app.tempFields[index];
    if (!field) return;
    elements.fieldLabel.value = field.label;
    elements.fieldType.value = field.type;
    elements.fieldRequired.checked = field.required;
    app.editingFieldIndex = index;
    elements.addFieldBtn.textContent = 'Update field';
}

function deleteField(index) {
    app.tempFields.splice(index, 1);
    renderFieldsEditor(app.tempFields);
}

function handleFieldAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const index = Number(button.dataset.index);
    if (action === 'edit-field') {
        openFieldEditor(index);
    } else if (action === 'delete-field') {
        deleteField(index);
    }
}

async function saveBuilderForm(event) {
    event.preventDefault();
    clearMessages();
    const titleValue = elements.formTitle.value.trim();
    const descriptionValue = elements.formDescription.value.trim();
    const emailValue = elements.formEmail.value.trim();
    const fields = app.tempFields || [];
    if (!titleValue) {
        showMessage('error', 'Form title is required.');
        return;
    }
    if (!emailValue) {
        showMessage('error', 'Notification email is required.');
        return;
    }
    if (fields.length === 0) {
        showMessage('error', 'Add at least one field to your form.');
        return;
    }
    const payload = {
        title: titleValue,
        description: descriptionValue,
        email: emailValue,
        fields,
    };
    try {
        let savedForm;
        if (app.isEditing && app.activeFormId) {
            savedForm = await fetchJson(`/api/forms/${encodeURIComponent(app.activeFormId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            showMessage('success', 'Form updated successfully.');
        } else {
            savedForm = await fetchJson('/api/forms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            showMessage('success', 'Form created successfully.');
        }
        app.activeFormId = savedForm.id;
        app.isEditing = false;
        initializeBuilderState();
        elements.builderSection.classList.add('hidden');
        elements.dashboardSection.classList.remove('hidden');
        await loadForms();
    } catch (error) {
        showMessage('error', error.message);
    }
}

function cancelBuilder() {
    initializeBuilderState();
    elements.builderSection.classList.add('hidden');
    elements.dashboardSection.classList.remove('hidden');
    clearMessages();
}

async function registerUser(event) {
    event.preventDefault();
    clearMessages();
    const name = document.getElementById('signupName').value.trim();
    const username = document.getElementById('signupUsername').value.trim().toLowerCase();
    const password = document.getElementById('signupPassword').value;
    if (!name || !username || !password) {
        showMessage('error', 'Please complete all signup fields.');
        return;
    }
    try {
        const result = await fetchJson('/api/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, username, password }),
        });
        app.currentUser = result.user;
        app.authToken = result.token;
        saveAuthState();
        await loadForms();
        renderView();
        showMessage('success', 'Account created. You are now signed in.');
    } catch (error) {
        showMessage('error', error.message);
    }
}

async function loginUser(event) {
    event.preventDefault();
    clearMessages();
    const username = document.getElementById('loginUsername').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value;
    if (!username || !password) {
        showMessage('error', 'Please enter your username and password.');
        return;
    }
    try {
        const result = await fetchJson('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        app.currentUser = result.user;
        app.authToken = result.token;
        saveAuthState();
        await loadForms();
        renderView();
        showMessage('success', 'Signed in successfully.');
    } catch (error) {
        showMessage('error', error.message);
    }
}

function logoutUser() {
    clearAuthState();
    app.forms = [];
    clearMessages();
    renderView();
}

function populateBuilder(form) {
    app.activeFormId = form.id;
    app.isEditing = true;
    app.tempFields = form.fields.map((field) => ({ ...field }));
    app.editingFieldIndex = null;
    elements.addFieldBtn.textContent = 'Add field';
    elements.builderTitle.textContent = 'Edit form';
    elements.formTitle.value = form.title;
    elements.formDescription.value = form.description;
    elements.formEmail.value = form.email;
    renderFieldsEditor(app.tempFields);
}

function resetBuilder() {
    app.activeFormId = null;
    app.isEditing = false;
    app.tempFields = [];
    app.editingFieldIndex = null;
    elements.formTitle.value = '';
    elements.formDescription.value = '';
    elements.formEmail.value = '';
    elements.fieldLabel.value = '';
    elements.fieldType.value = 'text';
    elements.fieldRequired.checked = false;
    elements.addFieldBtn.textContent = 'Add field';
    elements.builderTitle.textContent = 'Create a new form';
    renderFieldsEditor([]);
}

function initializeBuilderState() {
    resetBuilder();
}

function openBuilder(formId) {
    clearMessages();
    const form = app.forms.find((item) => item.id === formId);
    if (!form) return;
    populateBuilder(form);
    elements.builderSection.classList.remove('hidden');
    elements.dashboardSection.classList.add('hidden');
}

async function deleteForm(formId) {
    if (!confirm('Delete this form? This cannot be undone.')) {
        return;
    }
    try {
        await fetchJson(`/api/forms/${encodeURIComponent(formId)}`, { method: 'DELETE' });
        showMessage('success', 'Form deleted successfully.');
        await loadForms();
    } catch (error) {
        showMessage('error', error.message);
    }
}

function copyShareLink(formId) {
    const baseUrl = window.location.href.replace(/(?:index\.html)?(?:\?.*)?$/, '');
    const url = `${baseUrl}form.html?formId=${encodeURIComponent(formId)}`;
    navigator.clipboard.writeText(url).then(() => {
        showMessage('success', 'Shareable link copied to clipboard.');
    }).catch(() => {
        showMessage('error', 'Copy failed. Use this link: ' + url);
    });
}

function handleFormListClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (action === 'open') {
        window.open(`form.html?formId=${encodeURIComponent(id)}`, '_blank');
    } else if (action === 'edit') {
        openBuilder(id);
    } else if (action === 'delete') {
        deleteForm(id);
    } else if (action === 'link') {
        copyShareLink(id);
    }
}

function handleFieldFormSubmit(event) {
    event.preventDefault();
    if (elements.addFieldBtn.textContent === 'Update field') {
        const index = app.editingFieldIndex;
        if (index == null) return;
        const label = elements.fieldLabel.value.trim();
        const type = elements.fieldType.value;
        const required = elements.fieldRequired.checked;
        if (!label) {
            showMessage('error', 'Field label cannot be empty.');
            return;
        }
        app.tempFields[index] = { ...app.tempFields[index], label, type, required };
        elements.addFieldBtn.textContent = 'Add field';
        app.editingFieldIndex = null;
        elements.fieldLabel.value = '';
        elements.fieldType.value = 'text';
        elements.fieldRequired.checked = false;
        renderFieldsEditor(app.tempFields);
        clearMessages();
        return;
    }
    addField();
}

function addEventListeners() {
    elements.authTabs.forEach((tab) => tab.addEventListener('click', switchAuthTab));
    elements.loginForm.addEventListener('submit', loginUser);
    elements.signupForm.addEventListener('submit', registerUser);
    elements.formEditor.addEventListener('submit', (event) => event.preventDefault());
    elements.logoutBtn.addEventListener('click', logoutUser);
    elements.newFormBtn.addEventListener('click', () => {
        initializeBuilderState();
        elements.dashboardSection.classList.add('hidden');
        elements.builderSection.classList.remove('hidden');
        clearMessages();
    });
    elements.formSaveBtn.addEventListener('click', saveBuilderForm);
    elements.formCancelBtn.addEventListener('click', cancelBuilder);
    elements.addFieldBtn.addEventListener('click', handleFieldFormSubmit);
    elements.fieldsList.addEventListener('click', handleFieldAction);
    elements.formTitle.addEventListener('input', updatePreview);
    elements.formDescription.addEventListener('input', updatePreview);
    elements.formEmail.addEventListener('input', updatePreview);
    elements.formList.addEventListener('click', handleFormListClick);
}

async function init() {
    syncState();
    addEventListeners();
    initializeBuilderState();
    if (app.authToken && app.currentUser) {
        try {
            const userCheck = await fetchJson('/api/me');
            app.currentUser = userCheck.user;
            saveAuthState();
            await loadForms();
        } catch {
            clearAuthState();
        }
    }
    renderView();
}

window.addEventListener('DOMContentLoaded', init);
