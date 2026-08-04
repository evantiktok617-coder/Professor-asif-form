const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const cors = require('cors');
const app = express();

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const FORMS_FILE = path.join(DATA_DIR, 'forms.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'submissions.json');

const PORT = process.env.APP_PORT || 8000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

async function ensureDataFiles() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const files = [USERS_FILE, FORMS_FILE, SESSIONS_FILE, SUBMISSIONS_FILE];
    await Promise.all(files.map(async (file) => {
        try {
            await fs.access(file);
        } catch {
            await fs.writeFile(file, '[]', 'utf8');
        }
    }));
}

async function readJson(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        return JSON.parse(content || '[]');
    } catch (error) {
        return [];
    }
}

async function writeJson(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function createId() {
    return crypto.randomBytes(10).toString('hex');
}

async function loadSessionUser(token) {
    if (!token) {
        return null;
    }
    const sessions = await readJson(SESSIONS_FILE);
    const session = sessions.find((item) => item.token === token);
    if (!session) {
        return null;
    }
    const users = await readJson(USERS_FILE);
    return users.find((user) => user.username === session.username) || null;
}

async function createSession(user) {
    const sessions = await readJson(SESSIONS_FILE);
    const token = crypto.randomBytes(24).toString('hex');
    sessions.push({ token, username: user.username, createdAt: Date.now() });
    await writeJson(SESSIONS_FILE, sessions);
    return token;
}

function requireJson(fields, body) {
    return fields.every((field) => typeof body[field] === 'string' && body[field].trim().length > 0);
}

async function getEmailTransport() {
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    }

    const testAccount = await nodemailer.createTestAccount();
    return nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: {
            user: testAccount.user,
            pass: testAccount.pass,
        },
    });
}

async function sendEmail(to, subject, html, text) {
    const transporter = await getEmailTransport();
    const info = await transporter.sendMail({
        from: process.env.EMAIL_FROM || 'forms@localhost',
        to,
        subject,
        text,
        html,
    });
    const preview = nodemailer.getTestMessageUrl(info);
    return { info, preview };
}

async function authMiddleware(req, res, next) {
    const authorization = req.headers.authorization;
    if (!authorization || !authorization.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authorization.replace('Bearer ', '');
    const user = await loadSessionUser(token);
    if (!user) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
}

app.post('/api/signup', async (req, res) => {
    const { name, username, password } = req.body || {};
    if (!requireJson(['name', 'username', 'password'], req.body)) {
        return res.status(400).json({ error: 'Name, username, and password are required.' });
    }
    const normalized = username.trim().toLowerCase();
    const users = await readJson(USERS_FILE);
    if (users.find((user) => user.username === normalized)) {
        return res.status(409).json({ error: 'Username already exists.' });
    }
    const user = {
        id: createId(),
        name: name.trim(),
        username: normalized,
        passwordHash: hashPassword(password),
    };
    users.push(user);
    await writeJson(USERS_FILE, users);
    const token = await createSession(user);
    res.json({ user: { id: user.id, name: user.name, username: user.username }, token });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!requireJson(['username', 'password'], req.body)) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }
    const normalized = username.trim().toLowerCase();
    const users = await readJson(USERS_FILE);
    const user = users.find((item) => item.username === normalized && item.passwordHash === hashPassword(password));
    if (!user) {
        return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const token = await createSession(user);
    res.json({ user: { id: user.id, name: user.name, username: user.username }, token });
});

app.get('/api/me', authMiddleware, async (req, res) => {
    res.json({ user: { id: req.user.id, name: req.user.name, username: req.user.username } });
});

app.get('/api/forms', authMiddleware, async (req, res) => {
    const forms = await readJson(FORMS_FILE);
    const userForms = forms.filter((form) => form.owner === req.user.username);
    res.json(userForms);
});

app.post('/api/forms', authMiddleware, async (req, res) => {
    const { title, description, email, fields } = req.body || {};
    if (!title?.trim() || !email?.trim() || !Array.isArray(fields) || fields.length === 0) {
        return res.status(400).json({ error: 'Title, email, and at least one field are required.' });
    }
    const forms = await readJson(FORMS_FILE);
    const form = {
        id: createId(),
        owner: req.user.username,
        title: title.trim(),
        description: (description || '').trim(),
        email: email.trim(),
        fields: fields.map((field) => ({ ...field, id: field.id || createId() })),
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    forms.push(form);
    await writeJson(FORMS_FILE, forms);
    res.json(form);
});

app.put('/api/forms/:id', authMiddleware, async (req, res) => {
    const formId = req.params.id;
    const { title, description, email, fields } = req.body || {};
    if (!title?.trim() || !email?.trim() || !Array.isArray(fields) || fields.length === 0) {
        return res.status(400).json({ error: 'Title, email, and at least one field are required.' });
    }
    const forms = await readJson(FORMS_FILE);
    const form = forms.find((item) => item.id === formId);
    if (!form) {
        return res.status(404).json({ error: 'Form not found.' });
    }
    if (form.owner !== req.user.username) {
        return res.status(403).json({ error: 'Forbidden. You do not own this form.' });
    }
    form.title = title.trim();
    form.description = (description || '').trim();
    form.email = email.trim();
    form.fields = fields.map((field) => ({ ...field, id: field.id || createId() }));
    form.updatedAt = Date.now();
    await writeJson(FORMS_FILE, forms);
    res.json(form);
});

app.delete('/api/forms/:id', authMiddleware, async (req, res) => {
    const formId = req.params.id;
    const forms = await readJson(FORMS_FILE);
    const form = forms.find((item) => item.id === formId);
    if (!form) {
        return res.status(404).json({ error: 'Form not found.' });
    }
    if (form.owner !== req.user.username) {
        return res.status(403).json({ error: 'Forbidden. You do not own this form.' });
    }
    const updatedForms = forms.filter((item) => item.id !== formId);
    await writeJson(FORMS_FILE, updatedForms);
    res.json({ success: true });
});

app.get('/api/forms/:id', async (req, res) => {
    const formId = req.params.id;
    const forms = await readJson(FORMS_FILE);
    const form = forms.find((item) => item.id === formId);
    if (!form) {
        return res.status(404).json({ error: 'Form not found.' });
    }
    res.json(form);
});

app.post('/api/forms/:id/submit', async (req, res) => {
    const formId = req.params.id;
    const { values } = req.body || {};
    const forms = await readJson(FORMS_FILE);
    const form = forms.find((item) => item.id === formId);
    if (!form) {
        return res.status(404).json({ error: 'Form not found.' });
    }
    if (!values || typeof values !== 'object') {
        return res.status(400).json({ error: 'Submission values are required.' });
    }
    const submissions = await readJson(SUBMISSIONS_FILE);
    const submission = {
        id: createId(),
        formId: form.id,
        values,
        submittedAt: Date.now(),
    };
    submissions.push(submission);
    await writeJson(SUBMISSIONS_FILE, submissions);

    const subject = `New response: ${form.title}`;
    const textParts = [`Title: ${form.title}`, `Submitted At: ${new Date(submission.submittedAt).toLocaleString()}`, '', 'Responses:'];
    const htmlParts = [`<p><strong>Title:</strong> ${form.title}</p>`, `<p><strong>Submitted At:</strong> ${new Date(submission.submittedAt).toLocaleString()}</p>`, '<h3>Responses</h3>', '<ul>'];
    Object.entries(values).forEach(([key, value]) => {
        textParts.push(`${key}: ${value}`);
        htmlParts.push(`<li><strong>${key}:</strong> ${value}</li>`);
    });
    htmlParts.push('</ul>');
    const text = textParts.join('\n');
    const html = htmlParts.join('\n');

    try {
        const { preview } = await sendEmail(form.email, subject, html, text);
        const responsePayload = { success: true };
        if (preview) {
            responsePayload.previewUrl = preview;
        }
        res.json(responsePayload);
    } catch (error) {
        res.status(500).json({ error: 'Unable to send email. ' + error.message });
    }
});

app.get('/api/ping', (req, res) => res.json({ ok: true }));

(async () => {
    try {
        await ensureDataFiles();
        app.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
            console.log('Using data directory:', DATA_DIR);
        });
    } catch (error) {
        console.error('Server initialization failed:', error);
        process.exit(1);
    }
})();
