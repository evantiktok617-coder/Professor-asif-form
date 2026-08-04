# PK Form Builder

A simple form builder with account registration and email notifications.

## Features

- User signup/login
- Create and edit forms
- Specify an email address for submission notifications
- Generate a public form link
- Submit the form and email the response to the configured address

## Run locally

1. Copy `.env.example` to `.env` and fill in SMTP settings.
2. Install dependencies:

```bash
npm install
```

3. Start the server:

```bash
npm start
```

4. Open `http://localhost:8000`

## Notes

- Data is stored in `data/` as JSON files.
- The backend API is implemented in `server.js`.
- Use a real SMTP provider or the built-in Nodemailer test account configured by `.env`.
