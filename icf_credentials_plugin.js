/**
 * ICF Collect — Credentials Plugin v2.0
 * =========================================
 * Drop-in plugin that adds form access control to ICF Collect.
 *
 * INSTALL: Add this ONE line before </body> in your HTML:
 *   <script src="icf_credentials_plugin.js"></script>
 *
 * That's it. No other changes needed.
 */

(function () {
    'use strict';

    // ==================== 1. INJECT CSS ====================
    const css = `
    #credentialsPanel {
        margin-top: 20px; padding: 14px; background: #f8faff;
        border: 1px solid #d0e0f5; border-radius: 8px;
    }
    #sharedFormLoginGate {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: linear-gradient(135deg, #004080, #001a33);
        display: none; justify-content: center; align-items: center;
        z-index: 9999; padding: 20px; font-family: 'Oswald', Arial, sans-serif;
    }
    #sharedFormLoginGate.show { display: flex; }
    .sfg-card {
        background: #fff; border-radius: 16px;
        box-shadow: 0 20px 40px rgba(0,0,0,.3);
        padding: 40px 36px; width: 100%; max-width: 420px;
    }
    .sfg-logo { text-align: center; margin-bottom: 28px; }
    .sfg-logo .sfg-icon { font-size: 44px; display: block; margin-bottom: 12px; }
    .sfg-logo h2 { margin: 0 0 6px; font-size: 20px; color: #004080; font-weight: 700; }
    .sfg-logo p { margin: 0; font-size: 13px; color: #666; }
    .sfg-msg { padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 14px; display: none; }
    .sfg-msg.error  { background: #fff0f0; border: 1px solid #ffcccc; color: #cc0000; display: block; }
    .sfg-msg.success{ background: #f0fff4; border: 1px solid #c3e6cb; color: #155724; display: block; }
    .sfg-fields { display: flex; flex-direction: column; gap: 16px; }
    .sfg-group label {
        display: block; font-size: 11px; font-weight: 700; color: #444;
        margin-bottom: 5px; text-transform: uppercase; letter-spacing: .5px;
    }
    .sfg-group input {
        width: 100%; padding: 11px 13px; border: 2px solid #d0d9e8;
        border-radius: 8px; font-size: 14px; box-sizing: border-box;
        font-family: 'Oswald', sans-serif;
    }
    .sfg-group input:focus { outline: none; border-color: #004080; box-shadow: 0 0 0 3px rgba(0,64,128,.1); }
    .sfg-btn {
        background: #004080; color: #fff; border: none; border-radius: 8px;
        padding: 13px; font-size: 15px; font-weight: 700; cursor: pointer;
        font-family: 'Oswald', sans-serif;
    }
    .sfg-btn:hover { background: #003060; }
    @keyframes sfgShake {
        0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)}
        40%{transform:translateX(8px)} 60%{transform:translateX(-6px)} 80%{transform:translateX(6px)}
    }
    .sfg-shake { animation: sfgShake .45s ease; }
    #shareNote { font-size: 12px; margin-top: 8px; padding: 8px 12px; border-radius: 6px; display: none; }
    `;
    const styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    // ==================== 2. INJECT HTML ON DOM READY ====================
    document.addEventListener('DOMContentLoaded', function () {

        // 2a. Login Gate — before .notification div
        const notifEl = document.getElementById('notification');
        if (notifEl) {
            notifEl.insertAdjacentHTML('beforebegin', `
            <div id="sharedFormLoginGate">
                <div class="sfg-card">
                    <div class="sfg-logo">
                        <span class="sfg-icon">&#128274;</span>
                        <h2 id="sfgFormTitle">Form</h2>
                        <p>This form requires login to access.</p>
                    </div>
                    <div id="sfgMsg" class="sfg-msg"></div>
                    <div class="sfg-fields">
                        <div class="sfg-group">
                            <label>Username</label>
                            <input type="text" id="sfgUsername" placeholder="Enter your username"
                                   onkeydown="if(event.key==='Enter') sfgLogin()">
                        </div>
                        <div class="sfg-group">
                            <label>Password</label>
                            <input type="password" id="sfgPassword" placeholder="Enter your password"
                                   onkeydown="if(event.key==='Enter') sfgLogin()">
                        </div>
                        <button class="sfg-btn" onclick="sfgLogin()">Access Form &#8594;</button>
                    </div>
                </div>
            </div>`);
        }

        // 2b. Credentials Panel — appended to properties panel
        const propsPanel = document.getElementById('propertiesPanel');
        if (propsPanel) {
            const div = document.createElement('div');
            div.id = 'credentialsPanel';
            propsPanel.appendChild(div);
        }

        // 2c. shareNote — after qr-actions in share modal
        const qrActions = document.querySelector('#shareModal .qr-actions');
        if (qrActions) {
            const p = document.createElement('p');
            p.id = 'shareNote';
            qrActions.after(p);
        }

        // 2d. Watch for builder becoming visible → render credentials panel
        const mainContainer = document.getElementById('mainContainer');
        if (mainContainer) {
            new MutationObserver(function (mutations) {
                mutations.forEach(function (m) {
                    if (m.type === 'attributes' && m.attributeName === 'class') {
                        if (mainContainer.classList.contains('show')) {
                            setTimeout(renderCredentialsPanel, 150);
                        }
                    }
                });
            }).observe(mainContainer, { attributes: true });
        }

        // 2e. Hook shareForm + renderSharedForm after main app has initialised
        //     300ms is enough for inline scripts to run synchronously after DOMContentLoaded
        setTimeout(function () {

            // ---- HOOK shareForm ----
            var _origShareForm = window.shareForm;
            if (typeof _origShareForm === 'function') {

                window.shareForm = async function () {
                    // Load latest credentials from localStorage
                    try {
                        window.formCredentials = JSON.parse(localStorage.getItem('icfFormCredentials') || '[]');
                    } catch (e) { window.formCredentials = []; }

                    // Intercept pako.deflate for exactly ONE call so we can inject
                    // credentials into the JSON payload before it gets compressed.
                    if (window.pako && typeof window.pako.deflate === 'function') {
                        const _origDeflate = window.pako.deflate;
                        window.pako.deflate = function (data) {
                            // Restore immediately so only this call is intercepted
                            window.pako.deflate = _origDeflate;
                            try {
                                const parsed = JSON.parse(data);
                                if (parsed && parsed.s) {
                                    parsed.s.creds = window.formCredentials;
                                }
                                return _origDeflate(JSON.stringify(parsed));
                            } catch (e) {
                                // If anything goes wrong, compress unmodified
                                return _origDeflate(data);
                            }
                        };
                    }

                    // Run original shareForm
                    await _origShareForm.apply(this, arguments);

                    // Show credential status note
                    const note = document.getElementById('shareNote');
                    if (note) {
                        if (!window.formCredentials || window.formCredentials.length === 0) {
                            note.textContent = '\u26a0\ufe0f No credentials set \u2014 this form is open to everyone.';
                            note.style.background = '#fff3cd'; note.style.color = '#856404';
                        } else {
                            note.textContent = '\ud83d\udd12 ' + window.formCredentials.length + ' credential(s) embedded. Users must log in.';
                            note.style.background = '#d4edda'; note.style.color = '#155724';
                        }
                        note.style.display = 'block';
                    }
                };
            } else {
                console.warn('ICF Credentials Plugin: shareForm() not found — check script load order.');
            }

            // ---- HOOK renderSharedForm ----
            var _origRenderSharedForm = window.renderSharedForm;
            if (typeof _origRenderSharedForm === 'function') {

                window.renderSharedForm = async function (data) {
                    const embeddedCreds = (data && data.s && data.s.creds) ? data.s.creds : [];

                    if (embeddedCreds.length > 0) {
                        // Credentials present — show login gate, keep viewer hidden

                        window._sfgCredentials = embeddedCreds;

                        // Set form title in login gate
                        const titleEl = document.getElementById('sfgFormTitle');
                        if (titleEl) titleEl.textContent = (data.s && data.s.t) ? data.s.t : 'Form';

                        // Hide header/footer/builder
                        const header       = document.querySelector('.header');
                        const footer       = document.querySelector('.footer');
                        const authCont     = document.getElementById('authContainer');
                        const mainCont     = document.getElementById('mainContainer');
                        if (header)   header.style.display   = 'none';
                        if (footer)   footer.style.display   = 'none';
                        if (authCont) authCont.style.display  = 'none';
                        if (mainCont) mainCont.classList.remove('show');

                        // Show login gate
                        const gate = document.getElementById('sharedFormLoginGate');
                        if (gate) gate.classList.add('show');

                        // Temporarily suppress viewerContainer.classList.add('show')
                        // so the form stays hidden behind the login gate.
                        const vc = document.getElementById('viewerContainer');
                        if (vc) {
                            var _origClassAdd = vc.classList.add.bind(vc.classList);
                            vc.classList.add = function (cls) {
                                if (cls === 'show') {
                                    vc.classList.add = _origClassAdd; // restore
                                    return; // suppress — sfgLogin() will call show
                                }
                                return _origClassAdd(cls);
                            };
                        }

                        // Run original to set up state & render form DOM
                        await _origRenderSharedForm.call(this, data);

                    } else {
                        // No credentials — open access, unchanged
                        window._sfgCredentials = [];
                        await _origRenderSharedForm.call(this, data);
                    }
                };
            } else {
                console.warn('ICF Credentials Plugin: renderSharedForm() not found — check script load order.');
            }

            console.log('\u2705 ICF Credentials Plugin v2.0 loaded');

        }, 300);
    });

    // ==================== 3. CREDENTIALS STATE ====================
    window.formCredentials = [];

    // ==================== 4. CREDENTIALS PANEL ====================
    window.renderCredentialsPanel = function () {
        const panel = document.getElementById('credentialsPanel');
        if (!panel) return;
        try {
            window.formCredentials = JSON.parse(localStorage.getItem('icfFormCredentials') || '[]');
        } catch (e) { window.formCredentials = []; }

        panel.innerHTML = `
            <div style="margin-top:5px;">
                <div style="font-size:11px;font-weight:700;color:#004080;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">
                    &#128274; Form Access Credentials
                </div>
                <p style="font-size:11px;color:#666;margin:0 0 10px;">
                    Users must log in before accessing the shared form. Leave empty for open access.
                </p>
                <div id="sfgCredList" style="margin-bottom:10px;"></div>
                <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:end;">
                    <div>
                        <label style="font-size:10px;color:#555;display:block;margin-bottom:3px;font-weight:700;text-transform:uppercase;">Username</label>
                        <input type="text" id="sfgNewUser" placeholder="e.g. john_doe"
                               style="width:100%;padding:7px 9px;border:1px solid #ccc;border-radius:4px;font-family:'Oswald',sans-serif;font-size:12px;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:10px;color:#555;display:block;margin-bottom:3px;font-weight:700;text-transform:uppercase;">Password</label>
                        <input type="password" id="sfgNewPass" placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;"
                               style="width:100%;padding:7px 9px;border:1px solid #ccc;border-radius:4px;font-family:'Oswald',sans-serif;font-size:12px;box-sizing:border-box;">
                    </div>
                    <button onclick="sfgAddCredential()"
                            style="padding:7px 12px;background:#004080;color:#fff;border:none;border-radius:4px;cursor:pointer;font-family:'Oswald',sans-serif;font-weight:700;font-size:12px;height:32px;align-self:end;">
                        + Add
                    </button>
                </div>
                <div id="sfgCredMsg" style="font-size:11px;margin-top:5px;display:none;"></div>
            </div>`;
        sfgRenderCredList();
    };

    window.sfgRenderCredList = function () {
        const list = document.getElementById('sfgCredList');
        if (!list) return;
        if (!window.formCredentials || window.formCredentials.length === 0) {
            list.innerHTML = '<p style="font-size:11px;color:#aaa;font-style:italic;margin:0;">No credentials set \u2014 form is open access.</p>';
            return;
        }
        list.innerHTML = window.formCredentials.map(function (cred, i) {
            return '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#f0f5ff;border:1px solid #c5d8f5;border-radius:4px;margin-bottom:5px;">' +
                '<div><span style="font-weight:700;font-size:12px;color:#004080;">' + _escHtml(cred.username) + '</span>' +
                '<span style="font-size:10px;color:#888;margin-left:8px;">\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022</span></div>' +
                '<button onclick="sfgRemoveCredential(' + i + ')" style="background:none;border:none;color:#cc0000;cursor:pointer;font-size:18px;line-height:1;padding:0 4px;">\u00d7</button>' +
                '</div>';
        }).join('');
    };

    window.sfgAddCredential = function () {
        const userInput = document.getElementById('sfgNewUser');
        const passInput = document.getElementById('sfgNewPass');
        const msg       = document.getElementById('sfgCredMsg');
        const username  = userInput.value.trim();
        const password  = passInput.value.trim();

        if (!username || !password) {
            msg.textContent = 'Both username and password are required.';
            msg.style.color = 'red'; msg.style.display = 'block'; return;
        }
        if (window.formCredentials.some(function (c) {
            return c.username.toLowerCase() === username.toLowerCase();
        })) {
            msg.textContent = 'Username already exists.';
            msg.style.color = 'red'; msg.style.display = 'block'; return;
        }
        window.formCredentials.push({ username: username, password: password });
        localStorage.setItem('icfFormCredentials', JSON.stringify(window.formCredentials));
        userInput.value = ''; passInput.value = '';
        msg.textContent = '\u2713 "' + username + '" added.';
        msg.style.color = 'green'; msg.style.display = 'block';
        setTimeout(function () { msg.style.display = 'none'; }, 2500);
        sfgRenderCredList();
        if (typeof notify === 'function') notify('Credential "' + username + '" added', 'success');
    };

    window.sfgRemoveCredential = function (index) {
        if (!confirm('Remove user "' + window.formCredentials[index].username + '"?')) return;
        window.formCredentials.splice(index, 1);
        localStorage.setItem('icfFormCredentials', JSON.stringify(window.formCredentials));
        sfgRenderCredList();
    };

    // ==================== 5. LOGIN GATE ====================
    window.sfgLogin = function () {
        const username = document.getElementById('sfgUsername').value.trim();
        const password = document.getElementById('sfgPassword').value.trim();
        const msg      = document.getElementById('sfgMsg');

        if (!username || !password) {
            msg.textContent = 'Please enter both username and password.';
            msg.className = 'sfg-msg error'; return;
        }
        const creds = window._sfgCredentials || [];
        const match = creds.find(function (c) {
            return c.username.toLowerCase() === username.toLowerCase() && c.password === password;
        });
        if (!match) {
            msg.textContent = '\u2717 Invalid username or password.';
            msg.className = 'sfg-msg error';
            const card = document.querySelector('.sfg-card');
            if (card) {
                card.classList.add('sfg-shake');
                setTimeout(function () { card.classList.remove('sfg-shake'); }, 500);
            }
            return;
        }
        msg.textContent = '\u2713 Welcome, ' + match.username + '!';
        msg.className = 'sfg-msg success';
        setTimeout(function () {
            document.getElementById('sharedFormLoginGate').classList.remove('show');
            document.getElementById('viewerContainer').classList.add('show');
        }, 600);
    };

    // ==================== UTILITY ====================
    function _escHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

})();
