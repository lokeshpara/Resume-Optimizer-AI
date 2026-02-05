// =====================================================
// ENHANCED APPLICATION PAGE JAVASCRIPT
// =====================================================

const appId = location.pathname.split('/').pop();
let appData = null;
let currentField = null;
let currentContactId = null;

// =====================================================
// FIELD METADATA
// =====================================================

const fieldMeta = {
    company_name: {
        title: 'Edit Company Name',
        hint: 'The company you applied to',
        type: 'text'
    },
    position_applied: {
        title: 'Edit Position',
        hint: 'Role title used for this application',
        type: 'text'
    },
    status: {
        title: 'Edit Status',
        hint: 'Current stage of the application',
        type: 'select'
    },
    resume_link: {
        title: 'Edit Resume Link',
        hint: 'Google Drive or hosted resume link',
        type: 'text'
    },
    jd_link: {
        title: 'Edit Job Posting Link',
        hint: 'Original job posting URL',
        type: 'text'
    },
    jd_text: {
        title: 'Edit Job Description',
        hint: 'Full JD used for resume optimization',
        type: 'textarea'
    }
};

// =====================================================
// INITIALIZATION
// =====================================================

async function init() {
    await loadApplication();
    await loadNotes();
    await loadContacts();
    await displayTailoringAnalysis();
}

// =====================================================
// LOAD APPLICATION
// =====================================================

async function loadApplication() {
    try {
        const res = await fetch(`/api/applications/${appId}`);
        appData = await res.json();

        // Basic info
        companyText.textContent = appData.company_name;
        positionText.textContent = appData.position_applied;

        // Status with class
        statusText.textContent = appData.status;
        statusText.className = `status ${appData.status.toLowerCase()}`;

        // Dates
        dateText.textContent = formatDate(appData.date_applied);
        updatedText.textContent = formatDateTime(appData.updated_at);

        // Links
        resumeLink.textContent = appData.resume_link || 'No link provided';
        resumeLink.href = appData.resume_link || '#';
        if (!appData.resume_link) resumeLink.style.pointerEvents = 'none';

        jdLink.textContent = appData.jd_link || 'No link provided';
        jdLink.href = appData.jd_link || '#';
        if (!appData.jd_link) jdLink.style.pointerEvents = 'none';

        // JD Text
        jdText.textContent = appData.jd_text || 'No job description available';
    } catch (error) {
        console.error('Failed to load application:', error);
        alert('Failed to load application details');
        window.location.href = '/dashboard';
    }
}

// =====================================================
// DISPLAY TAILORING ANALYSIS
// =====================================================

async function displayTailoringAnalysis() {
    try {
        // Check if appData has tailoring analysis
        if (!appData.tailoringAnalysis) {
            document.getElementById('tailoringPlaceholder').style.display = 'block';
            document.getElementById('tailoringAnalysis').classList.add('hidden');
            return;
        }

        const analysis = appData.tailoringAnalysis;
        
        // Show analysis section
        document.getElementById('tailoringPlaceholder').style.display = 'none';
        document.getElementById('tailoringAnalysis').classList.remove('hidden');

        // Display score
        document.getElementById('tailoringScoreNumber').textContent = analysis.tailoringScore + '%';

        // Display risk with color
        const riskEl = document.getElementById('tailoringRisk');
        riskEl.textContent = analysis.tailoringRisk;
        
        // Set risk color
        if (analysis.tailoringRisk.includes('LOW')) {
            riskEl.className = 'risk-level low';
        } else if (analysis.tailoringRisk.includes('MEDIUM')) {
            riskEl.className = 'risk-level medium';
        } else {
            riskEl.className = 'risk-level high';
        }

        // Display validators
        const validatorsList = document.getElementById('validatorsList');
        validatorsList.innerHTML = '';
        
        const validatorNames = [
            'JD Keyword Repetition',
            'Metrics Realism',
            'Skill Distribution',
            'Company-Specific Language',
            'Weak Skill Relevance'
        ];

        if (analysis.validatorsPassed) {
            const parts = analysis.validatorsPassed.split('/');
            const passed = parseInt(parts[0]);
            const total = parseInt(parts[1]);

            for (let i = 0; i < total; i++) {
                const isPassed = i < passed;
                const icon = isPassed ? '✅' : '⚠️';
                const status = isPassed ? 'passed' : 'failed';
                const li = document.createElement('div');
                li.className = `validator-item ${status}`;
                li.innerHTML = `<span class="validator-icon">${icon}</span><span class="validator-name">${validatorNames[i] || 'Validator ' + (i+1)}</span>`;
                validatorsList.appendChild(li);
            }
        }

        // Display verdict
        const verdictEl = document.getElementById('tailoringVerdict');
        if (analysis.tailoringScore >= 75) {
            verdictEl.textContent = '✅ Resume works for multiple similar positions. This resume should be safe to submit to similar roles.';
        } else if (analysis.tailoringScore >= 50) {
            verdictEl.textContent = '⚠️ Resume has some customization. Make small adjustments before applying to other companies.';
        } else {
            verdictEl.textContent = '🔴 Resume looks obviously tailored. Requires significant revision for other applications.';
        }

        // Display recommendations
        const recList = document.getElementById('recommendationsList');
        recList.innerHTML = '';
        
        if (analysis.recommendations && analysis.recommendations.length > 0) {
            analysis.recommendations.forEach(rec => {
                const li = document.createElement('li');
                li.textContent = typeof rec === 'string' ? rec : (rec.message || JSON.stringify(rec));
                recList.appendChild(li);
            });
        } else {
            const li = document.createElement('li');
            li.textContent = 'No specific recommendations at this time.';
            recList.appendChild(li);
        }
    } catch (error) {
        console.error('Failed to display tailoring analysis:', error);
    }
}

// =====================================================
// FIELD EDITOR
// =====================================================

function openEditor(field) {
    currentField = field;

    editorTitle.textContent = fieldMeta[field].title;
    editorHint.textContent = fieldMeta[field].hint;

    editorInput.classList.add('hidden');
    editorSelect.classList.add('hidden');

    if (fieldMeta[field].type === 'select') {
        editorSelect.value = appData[field];
        editorSelect.classList.remove('hidden');
    } else {
        editorInput.value = appData[field] || '';
        editorInput.classList.remove('hidden');
    }

    editorOverlay.classList.remove('hidden');
}

function closeEditor() {
    editorOverlay.classList.add('hidden');
    currentField = null;
}

async function saveEditor() {
    if (!currentField) return;

    let value;

    if (fieldMeta[currentField].type === 'select') {
        value = editorSelect.value;
    } else {
        value = editorInput.value.trim();
    }

    if (value === appData[currentField]) {
        closeEditor();
        return;
    }

    try {
        await fetch(`/api/applications/${appId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [currentField]: value })
        });

        closeEditor();
        await loadApplication();
    } catch (error) {
        alert('Failed to update field');
        console.error(error);
    }
}

// =====================================================
// NOTES FUNCTIONALITY
// =====================================================

async function loadNotes() {
    try {
        const res = await fetch(`/api/applications/${appId}/notes`);
        const notes = await res.json();

        const notesList = document.getElementById('notesList');

        if (!notes || notes.length === 0) {
            notesList.innerHTML = '<div class="empty-state">No notes yet. Add a note to track important information.</div>';
            return;
        }

        notesList.innerHTML = notes.map(note => `
            <div class="note-item">
                <div class="note-text">${escapeHtml(note.note_text)}</div>
                <div class="note-meta">
                    <span>${formatDateTime(note.created_at)}</span>
                    <button class="note-delete" onclick="deleteNote(${note.id})">Delete</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to load notes:', error);
    }
}

function openNoteEditor() {
    document.getElementById('noteInput').value = '';
    document.getElementById('noteOverlay').classList.remove('hidden');
}

function closeNoteEditor() {
    document.getElementById('noteOverlay').classList.add('hidden');
}

async function saveNote() {
    const noteText = document.getElementById('noteInput').value.trim();

    if (!noteText) {
        alert('Please enter a note');
        return;
    }

    try {
        await fetch(`/api/applications/${appId}/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note_text: noteText })
        });

        closeNoteEditor();
        await loadNotes();
    } catch (error) {
        alert('Failed to save note');
        console.error(error);
    }
}

async function deleteNote(noteId) {
    if (!confirm('Delete this note?')) return;

    try {
        await fetch(`/api/notes/${noteId}`, { method: 'DELETE' });
        await loadNotes();
    } catch (error) {
        alert('Failed to delete note');
        console.error(error);
    }
}

// =====================================================
// CONTACTS FUNCTIONALITY
// =====================================================

async function loadContacts() {
    try {
        const res = await fetch(`/api/applications/${appId}/contacts`);
        const contacts = await res.json();

        const contactsList = document.getElementById('contactsList');

        if (!contacts || contacts.length === 0) {
            contactsList.innerHTML = '<div class="empty-state">No contacts yet. Add recruiters, referrals, or hiring managers.</div>';
            return;
        }

        contactsList.innerHTML = contacts.map(contact => `
            <div class="contact-card">
                <div class="contact-header">
                    <div>
                        <div class="contact-name">${escapeHtml(contact.full_name)}</div>
                        ${contact.role ? `<span class="contact-role">${escapeHtml(contact.role)}</span>` : ''}
                    </div>
                </div>
                
                <div class="contact-info">
                    ${contact.email ? `<a href="mailto:${contact.email}">📧 ${escapeHtml(contact.email)}</a>` : ''}
                    ${contact.linkedin_url ? `<a href="${contact.linkedin_url}" target="_blank">🔗 LinkedIn Profile</a>` : ''}
                </div>
                
                ${contact.notes ? `<div class="contact-notes">${escapeHtml(contact.notes)}</div>` : ''}
                
                <div class="contact-actions">
                    <button class="contact-btn edit" onclick="editContact(${contact.id})">✏️ Edit</button>
                    <button class="contact-btn delete" onclick="deleteContact(${contact.id})">🗑️ Delete</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to load contacts:', error);
    }
}

function openContactEditor() {
    currentContactId = null;
    document.getElementById('contactEditorTitle').textContent = 'Add Contact';
    document.getElementById('contactId').value = '';
    document.getElementById('contactName').value = '';
    document.getElementById('contactEmail').value = '';
    document.getElementById('contactLinkedin').value = '';
    document.getElementById('contactRole').value = '';
    document.getElementById('contactNotes').value = '';
    document.getElementById('contactOverlay').classList.remove('hidden');
}

function closeContactEditor() {
    document.getElementById('contactOverlay').classList.add('hidden');
    currentContactId = null;
}

async function editContact(contactId) {
    try {
        const res = await fetch(`/api/contacts/${contactId}`);
        const contact = await res.json();

        currentContactId = contactId;
        document.getElementById('contactEditorTitle').textContent = 'Edit Contact';
        document.getElementById('contactId').value = contactId;
        document.getElementById('contactName').value = contact.full_name || '';
        document.getElementById('contactEmail').value = contact.email || '';
        document.getElementById('contactLinkedin').value = contact.linkedin_url || '';
        document.getElementById('contactRole').value = contact.role || '';
        document.getElementById('contactNotes').value = contact.notes || '';
        document.getElementById('contactOverlay').classList.remove('hidden');
    } catch (error) {
        alert('Failed to load contact');
        console.error(error);
    }
}

async function saveContact() {
    const name = document.getElementById('contactName').value.trim();
    const email = document.getElementById('contactEmail').value.trim();
    const linkedin = document.getElementById('contactLinkedin').value.trim();
    const role = document.getElementById('contactRole').value;
    const notes = document.getElementById('contactNotes').value.trim();

    if (!name) {
        alert('Please enter a name');
        return;
    }

    const contactData = {
        full_name: name,
        email: email || null,
        linkedin_url: linkedin || null,
        role: role || null,
        notes: notes || null
    };

    try {
        if (currentContactId) {
            // Update existing contact
            await fetch(`/api/contacts/${currentContactId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(contactData)
            });
        } else {
            // Create new contact and link to application
            await fetch(`/api/applications/${appId}/contacts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(contactData)
            });
        }

        closeContactEditor();
        await loadContacts();
    } catch (error) {
        alert('Failed to save contact');
        console.error(error);
    }
}

async function deleteContact(contactId) {
    if (!confirm('Delete this contact?')) return;

    try {
        await fetch(`/api/applications/${appId}/contacts/${contactId}`, {
            method: 'DELETE'
        });
        await loadContacts();
    } catch (error) {
        alert('Failed to delete contact');
        console.error(error);
    }
}

// =====================================================
// DELETE APPLICATION
// =====================================================

const deleteOverlay = document.getElementById('deleteOverlay');
const cancelDelete = document.getElementById('cancelDelete');
const confirmDelete = document.getElementById('confirmDelete');

deleteBtn.onclick = () => {
    deleteOverlay.classList.remove('hidden');
};

cancelDelete.onclick = () => {
    deleteOverlay.classList.add('hidden');
};

confirmDelete.onclick = async () => {
    try {
        await fetch(`/api/applications/${appId}`, { method: 'DELETE' });
        window.location.href = '/dashboard';
    } catch (error) {
        alert('Failed to delete application');
        console.error(error);
    }
};

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function formatDateTime(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// =====================================================
// INITIALIZE
// =====================================================

init();
// =====================================================
// RECRUITER AUTOMATION FUNCTIONALITY
// =====================================================
function openRecruiterSettings() {
    // Just show the confirmation modal
    document.getElementById('recruiterSettingsOverlay').classList.remove('hidden');
}

function closeRecruiterSettings() {
    document.getElementById('recruiterSettingsOverlay').classList.add('hidden');
}




function showTestResult(message, type) {
    const testResult = document.getElementById('testResult');
    testResult.textContent = message;
    testResult.className = type === 'success' ? 'test-success' : 'test-error';
    setTimeout(() => testResult.textContent = '', 5000);
}

async function startRecruiterAutomation() {
    // No need to get API keys from UI - they're in .env
    
    // Close settings and show progress
    closeRecruiterSettings();
    showProgress();

    try {
        // Update progress steps
        updateProgressStep(1, 'active', 'Extracting job details...');
        
        const response = await fetch(`/api/applications/${appId}/find-recruiters`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})  // Empty body - server gets keys from .env
        });

        updateProgressStep(1, 'done', 'Job details extracted ✓');
        updateProgressStep(2, 'active', 'Searching Google...');
        
        await new Promise(r => setTimeout(r, 1000));
        updateProgressStep(2, 'done', 'Google search complete ✓');
        updateProgressStep(3, 'active', 'AI selecting top 3...');
        
        await new Promise(r => setTimeout(r, 1000));
        updateProgressStep(3, 'done', 'Top 3 recruiters selected ✓');
        updateProgressStep(4, 'active', 'Finding emails...');
        
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to find recruiters');
        }

        updateProgressStep(4, 'done', 'Emails found ✓');
        updateProgressStep(5, 'active', 'Generating emails...');
        
        await new Promise(r => setTimeout(r, 1000));
        updateProgressStep(5, 'done', 'Emails generated ✓');
        updateProgressStep(6, 'active', 'Creating drafts...');
        
        await new Promise(r => setTimeout(r, 1000));
        updateProgressStep(6, 'done', 'Drafts created ✓');

        // Hide progress after 2 seconds
        setTimeout(() => {
            hideProgress();
            displayRecruiterResults(data);
            loadContacts(); // Refresh contacts list
        }, 2000);

    } catch (error) {
        console.error('Error:', error);
        hideProgress();
        alert(`Failed: ${error.message}`);
    }
}

function showProgress() {
    document.getElementById('recruiterProgressOverlay').classList.remove('hidden');
    // Reset all steps
    for (let i = 1; i <= 6; i++) {
        updateProgressStep(i, 'pending', '');
    }
    document.getElementById('progressBarFill').style.width = '0%';
}

function hideProgress() {
    document.getElementById('recruiterProgressOverlay').classList.add('hidden');
}

function updateProgressStep(stepNum, status, text) {
    const step = document.getElementById(`step${stepNum}`);
    const icon = step.querySelector('.step-icon');
    const textEl = step.querySelector('.step-text');
    
    step.className = `progress-step ${status}`;
    
    if (status === 'active') {
        icon.textContent = '⏳';
    } else if (status === 'done') {
        icon.textContent = '✅';
    } else {
        icon.textContent = '⏳';
    }
    
    if (text) {
        textEl.textContent = text;
    }
    
    // Update progress bar
    const progress = (stepNum / 6) * 100;
    document.getElementById('progressBarFill').style.width = `${progress}%`;
}

function displayRecruiterResults(data) {
    // Show results section
    document.getElementById('recruiterResults').classList.remove('hidden');
    
    // Update stats
    document.getElementById('statSearched').textContent = data.stats.searched;
    document.getElementById('statSelected').textContent = data.stats.aiSelected;
    document.getElementById('statEmails').textContent = data.stats.emailsFound;
    document.getElementById('statDrafts').textContent = data.stats.draftsCreated;
    
    // Display recruiters
    const recruitersList = document.getElementById('recruitersList');
    
    if (data.recruiters.length === 0) {
        recruitersList.innerHTML = '<div class="empty-state">No recruiters found with valid emails.</div>';
        return;
    }
    
    recruitersList.innerHTML = data.recruiters.map(recruiter => `
        <div class="recruiter-mini-card">
            <div class="recruiter-mini-header">
                <span class="recruiter-rank">#${recruiter.rank}</span>
                <span class="recruiter-mini-name">${escapeHtml(recruiter.name)}</span>
            </div>
            <div class="recruiter-mini-email">📧 ${escapeHtml(recruiter.email)}</div>
            <div class="recruiter-mini-meta">
                <span>🎯 ${recruiter.confidence}% match</span>
                <a href="${recruiter.linkedinUrl}" target="_blank">LinkedIn</a>
                <a href="https://mail.google.com/mail/u/0/#drafts" target="_blank">View Draft</a>
            </div>
        </div>
    `).join('');
    
    // Show success message
    alert(`✅ Success! Found ${data.recruiters.length} recruiter(s) and created ${data.stats.draftsCreated} email draft(s).\n\nCheck your Gmail drafts to review and send.`);
}