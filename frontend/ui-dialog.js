(function () {
    'use strict';

    const queue = [];
    let active = null;

    function ensureDialog() {
        if (document.getElementById('spz-alert-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'spz-alert-overlay';
        overlay.innerHTML = `
            <div class="spz-alert-backdrop"></div>
            <section class="spz-alert-dialog" role="alertdialog" aria-modal="true" aria-labelledby="spz-alert-title" aria-describedby="spz-alert-message">
                <div class="spz-alert-brand"><span class="spz-alert-logo"><i class="fas fa-book-open"></i></span><span>Sar Pay Zone</span></div>
                <h2 id="spz-alert-title">Message</h2>
                <p id="spz-alert-message"></p>
                <button id="spz-alert-ok" type="button">OK</button>
            </section>`;
        document.body.appendChild(overlay);
        document.getElementById('spz-alert-ok').addEventListener('click', close);
        overlay.querySelector('.spz-alert-backdrop').addEventListener('click', close);
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && active) close();
        });
    }

    function open(item) {
        active = item;
        ensureDialog();
        const overlay = document.getElementById('spz-alert-overlay');
        document.getElementById('spz-alert-title').textContent = item.title || 'Message';
        document.getElementById('spz-alert-message').textContent = String(item.message ?? '');
        overlay.classList.add('is-visible');
        window.setTimeout(() => document.getElementById('spz-alert-ok')?.focus(), 40);
    }

    function close() {
        if (!active) return;
        const item = active;
        active = null;
        document.getElementById('spz-alert-overlay')?.classList.remove('is-visible');
        item.resolve();
        if (queue.length) window.setTimeout(() => open(queue.shift()), 120);
    }

    window.spzAlert = function (message, title) {
        return new Promise(resolve => {
            const item = { message, title, resolve };
            if (active) queue.push(item); else open(item);
        });
    };

    // Keep existing application code unchanged while replacing the browser-native box.
    window.alert = function (message) {
        window.spzAlert(message, 'Sar Pay Zone');
    };
})();
