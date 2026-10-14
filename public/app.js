(() => {
    'use strict';
    const $ = (id) => document.getElementById(id);
    let toastTimer;
    const toast = (message) => {
        $('toast').textContent = message;
        $('toast').hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
    };

    const timeFormats = [
        ['[data-local-month]', { month: 'short' }],
        ['[data-local-weekday]', { weekday: 'short' }],
        ['[data-local-day]', { day: '2-digit' }],
        ['[data-local-time]', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }],
        ['[data-local-date]', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }],
        ['[data-local-clock]', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }]
    ];
    timeFormats.forEach(([selector, options]) => {
        document.querySelectorAll(selector).forEach(el => {
            const date = new Date(el.dateTime);
            if (!Number.isNaN(date.getTime())) {
                el.textContent = new Intl.DateTimeFormat(undefined, options).format(date);
                el.title = 'Your local time · ' + Intl.DateTimeFormat().resolvedOptions().timeZone;
            }
        });
    });

    // In automatic mode the schedule is an agenda on phones.
    if (document.querySelector('.view-auto')) {
        const media = matchMedia('(max-width: 640px)');
        const updateView = () => {
            document.querySelectorAll('[data-view]').forEach(el => {
                const selected = el.dataset.view === (media.matches ? 'agenda' : 'calendar');
                el.classList.toggle('selected', selected);
                el.setAttribute('aria-current', selected ? 'true' : 'false');
            });
        };
        media.addEventListener('change', updateView);
        updateView();
    }

    document.querySelectorAll('[data-share]').forEach(button => button.addEventListener('click', async () => {
        const url = new URL(location.href);
        url.search = '';
        url.hash = '';
        try {
            await navigator.clipboard.writeText(url.href);
            toast('Invite link copied. Send it to your group.');
        } catch {
            // Clipboard requires HTTPS; self-hosted LAN users still get a usable link.
            window.prompt('Copy this invite link:', url.href);
        }
    }));
    document.querySelectorAll('form[data-confirm]').forEach(form => form.addEventListener('submit', event => {
        if (!window.confirm(form.dataset.confirm)) event.preventDefault();
    }));
    document.querySelectorAll('img').forEach(img => img.addEventListener('error', () => {
        img.hidden = true;
        if (img.parentElement.classList.contains('avatar')) img.parentElement.textContent = '?';
        else img.parentElement.classList.add('art-fallback');
    }));

    const form = $('session-form');
    if (!form) return;
    const gameInput = $('gameTitle');
    const imageInput = $('imageUrl');
    const results = $('autocomplete-results');
    const status = $('game-search-status');
    let debounce, controller, generation = 0, active = -1;
    let options = [];
    const localDate = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    $('date').min = localDate(new Date());
    $('timezone-hint').textContent = 'Your timezone: ' + Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' ') + '. Everyone sees the same start time.';
    const updatePreview = () => {
        $('preview-title').textContent = $('title').value.trim() || 'Your next adventure.';
        $('preview-game').textContent = gameInput.value.trim() || 'Pick your game';
        $('preview-players').textContent = $('maxPlayers').value || '4';
        const date = new Date($('date').value + 'T' + $('time').value);
        const valid = Number.isFinite(date.getTime());
        $('startTimeIso').value = valid ? date.toISOString() : '';
        $('preview-time').textContent = valid ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date) : 'A time that works for your group.';
        $('time').setCustomValidity(valid && date <= new Date() ? 'Choose a time in the future.' : '');
        $('preview-image').hidden = !imageInput.value;
        if (imageInput.value && $('preview-image').getAttribute('src') !== imageInput.value) $('preview-image').src = imageInput.value;
    };
    form.addEventListener('input', updatePreview);
    form.addEventListener('submit', event => {
        updatePreview();
        if (!form.reportValidity()) { event.preventDefault(); return; }
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        submit.textContent = 'Saving your session…';
    });
    window.addEventListener('pageshow', () => {
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = false;
        submit.textContent = 'Create session ↗';
    });
    updatePreview();

    const closeResults = () => {
        results.hidden = true;
        gameInput.setAttribute('aria-expanded', 'false');
        gameInput.removeAttribute('aria-activedescendant');
        active = -1;
    };
    const selectGame = (game) => {
        ++generation;
        controller?.abort();
        clearTimeout(debounce);
        gameInput.value = game.name;
        const image = typeof game.background_image === 'string' && /^https?:\/\//.test(game.background_image) ? game.background_image : '';
        imageInput.value = image;
        closeResults();
        status.textContent = image ? 'Game selected. Artwork will be included with your session.' : 'Game selected. You’re ready to make a plan.';
        updatePreview();
        gameInput.focus();
    };
    gameInput.addEventListener('input', () => {
        clearTimeout(debounce);
        controller?.abort();
        const request = ++generation;
        const query = gameInput.value.trim();
        imageInput.value = '';
        updatePreview();
        closeResults();
        options = [];
        results.replaceChildren();
        if (query.length < 3) {
            status.textContent = 'Type at least 3 letters for game suggestions. Manual names work too.';
            return;
        }
        debounce = setTimeout(async () => {
            controller = new AbortController();
            status.textContent = 'Looking up games on IGDB…';
            try {
                const response = await fetch('/api/games/search?q=' + encodeURIComponent(query), { signal: controller.signal });
                if (!response.ok) throw new Error('Game search failed');
                const games = await response.json();
                if (request !== generation) return;
                if (!Array.isArray(games)) throw new Error('Invalid game search response');
                results.replaceChildren();
                options = games.filter(game => typeof game.name === 'string').map((game, index) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'game-option';
                    button.id = 'game-option-' + index;
                    button.role = 'option';
                    button.tabIndex = -1;
                    button.setAttribute('aria-selected', 'false');
                    if (typeof game.background_image === 'string' && /^https?:\/\//.test(game.background_image)) {
                        const image = document.createElement('img');
                        image.src = game.background_image;
                        image.alt = '';
                        image.addEventListener('error', () => { image.hidden = true; });
                        button.append(image);
                    }
                    const name = document.createElement('span');
                    name.textContent = game.name;
                    button.append(name);
                    button.addEventListener('click', () => selectGame(game));
                    results.append(button);
                    return button;
                });
                results.hidden = !options.length;
                gameInput.setAttribute('aria-expanded', String(!!options.length));
                status.textContent = options.length ? 'Use ↑ and ↓ to choose a game, then Enter.' : 'No suggestions available. You can keep the game name you typed.';
            } catch (error) {
                if (error.name === 'AbortError' || request !== generation) return;
                closeResults();
                status.textContent = 'Game search is unavailable. You can still enter a game name and continue.';
            }
        }, 300);
    });
    gameInput.addEventListener('keydown', event => {
        if (event.key === 'Escape') { ++generation; controller?.abort(); clearTimeout(debounce); closeResults(); return; }
        if (results.hidden || !options.length) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            active = (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
            options.forEach((option, index) => option.setAttribute('aria-selected', String(index === active)));
            gameInput.setAttribute('aria-activedescendant', options[active].id);
            options[active].scrollIntoView({ block: 'nearest' });
        } else if (event.key === 'Enter' && active >= 0) {
            event.preventDefault();
            options[active].click();
        }
    });
    document.addEventListener('click', event => {
        if (!event.target.closest('.game-field')) { ++generation; controller?.abort(); clearTimeout(debounce); closeResults(); }
    });
    gameInput.addEventListener('blur', () => {
        setTimeout(() => {
            if (document.activeElement !== gameInput && !results.contains(document.activeElement)) {
                ++generation;
                controller?.abort();
                clearTimeout(debounce);
                closeResults();
            }
        }, 150);
    });
})();
