/**
 * ONIX Generator — Detail panel utilities
 * ISBN validation, autocomplete for subject codes.
 * Core detail logic is in app.js.
 */

// ISBN-13 validation and checksum
function validateISBN13(isbn) {
    const clean = isbn.replace(/[- ]/g, '');
    if (!/^\d{13}$/.test(clean)) return { valid: false, message: 'ISBN must be 13 digits' };

    let sum = 0;
    for (let i = 0; i < 12; i++) {
        sum += parseInt(clean[i]) * (i % 2 === 0 ? 1 : 3);
    }
    const checkDigit = (10 - (sum % 10)) % 10;
    if (checkDigit !== parseInt(clean[12])) {
        return { valid: false, message: `Invalid check digit. Expected ${checkDigit}, got ${clean[12]}` };
    }
    return { valid: true };
}

// Auto-calculate ISBN check digit
function calculateISBNCheckDigit(partial) {
    const clean = partial.replace(/[- ]/g, '');
    if (clean.length !== 12 || !/^\d{12}$/.test(clean)) return null;
    let sum = 0;
    for (let i = 0; i < 12; i++) {
        sum += parseInt(clean[i]) * (i % 2 === 0 ? 1 : 3);
    }
    return (10 - (sum % 10)) % 10;
}

// ISBN input auto-complete check digit
document.addEventListener('DOMContentLoaded', () => {
    const isbnInput = document.getElementById('f-isbn');
    if (isbnInput) {
        isbnInput.addEventListener('blur', () => {
            const val = isbnInput.value.replace(/[- ]/g, '');
            if (val.length === 12) {
                const check = calculateISBNCheckDigit(val);
                if (check !== null) {
                    isbnInput.value = val + check;
                }
            }
            if (val.length === 13) {
                const result = validateISBN13(val);
                isbnInput.style.borderColor = result.valid ? '' : 'var(--danger)';
                if (!result.valid) isbnInput.title = result.message;
                else isbnInput.title = '';
            }
        });
    }
});
