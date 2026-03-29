/**
 * Custom Dropdown Component
 * Replaces native <select class="input"> with a styled, searchable dropdown.
 * Auto-initializes on DOMContentLoaded and re-initializes on htmx:afterSwap.
 */
(function () {
    var CHEVRON_SVG = '<svg class="dropdown-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
    var CHECK_SVG = '<svg class="dropdown-option-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

    var SEARCH_THRESHOLD = 8; // show search if more than this many options

    function upgradeSelect(sel) {
        if (sel.getAttribute('data-dropdown-upgraded')) return;
        sel.setAttribute('data-dropdown-upgraded', '1');

        var isSmall = sel.classList.contains('dropdown-sm') ||
                      sel.closest('[data-dropdown-sm]') !== null;
        var isBlock = sel.style.width === '100%' || sel.classList.contains('w-full');

        // Build wrapper
        var wrapper = document.createElement('div');
        wrapper.className = 'dropdown' + (isSmall ? ' dropdown--sm' : '') + (isBlock ? ' dropdown--block' : '');

        // Trigger button
        var trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'dropdown-trigger';
        if (sel.style.width && sel.style.width !== '100%') {
            wrapper.style.width = sel.style.width;
        }

        var triggerText = document.createElement('span');
        triggerText.className = 'dropdown-trigger-text';
        trigger.appendChild(triggerText);

        var chevron = document.createElement('span');
        chevron.innerHTML = CHEVRON_SVG;
        trigger.appendChild(chevron);

        // Panel
        var panel = document.createElement('div');
        panel.className = 'dropdown-panel';

        // Search (only for long lists)
        var options = sel.querySelectorAll('option');
        var searchInput = null;
        if (options.length > SEARCH_THRESHOLD) {
            var searchWrap = document.createElement('div');
            searchWrap.className = 'dropdown-search';
            searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.placeholder = 'Search...';
            searchWrap.appendChild(searchInput);
            panel.appendChild(searchWrap);
        }

        // Options list
        var optionsList = document.createElement('div');
        optionsList.className = 'dropdown-options';

        var optionEls = [];
        options.forEach(function (opt) {
            var item = document.createElement('div');
            item.className = 'dropdown-option';
            item.setAttribute('data-value', opt.value);

            var check = document.createElement('span');
            check.innerHTML = CHECK_SVG;
            item.appendChild(check);

            var desc = opt.getAttribute('data-description');
            var textWrap = document.createElement('span');
            textWrap.style.display = 'flex';
            textWrap.style.flexDirection = 'column';
            textWrap.style.gap = '1px';
            textWrap.style.minWidth = '0';

            var label = document.createElement('span');
            label.textContent = opt.textContent;
            textWrap.appendChild(label);

            if (desc) {
                var descEl = document.createElement('span');
                descEl.textContent = desc;
                descEl.style.fontSize = '11px';
                descEl.style.color = 'var(--text-muted)';
                descEl.style.fontWeight = '400';
                descEl.style.whiteSpace = 'normal';
                descEl.style.lineHeight = '1.3';
                textWrap.appendChild(descEl);
                item.style.whiteSpace = 'normal';
                item.style.paddingTop = '6px';
                item.style.paddingBottom = '6px';
            }

            item.appendChild(textWrap);

            if (opt.value === sel.value) {
                item.classList.add('selected');
            }

            item.addEventListener('click', function (e) {
                e.stopPropagation();
                selectOption(opt.value, opt.textContent);
            });

            optionEls.push(item);
            optionsList.appendChild(item);
        });

        panel.appendChild(optionsList);
        wrapper.appendChild(trigger);
        wrapper.appendChild(panel);
        sel.parentNode.insertBefore(wrapper, sel);

        // Set initial display text
        var selectedOpt = sel.options[sel.selectedIndex];
        if (selectedOpt && selectedOpt.value) {
            triggerText.textContent = selectedOpt.textContent;
        } else {
            triggerText.textContent = selectedOpt ? selectedOpt.textContent : '';
            if (!selectedOpt || !selectedOpt.value) {
                triggerText.classList.add('dropdown-trigger-placeholder');
            }
        }

        var focusedIndex = -1;

        function selectOption(value, text) {
            sel.value = value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            triggerText.textContent = text;
            triggerText.classList.remove('dropdown-trigger-placeholder');
            optionEls.forEach(function (el) {
                el.classList.toggle('selected', el.getAttribute('data-value') === value);
            });
            close();
        }

        function open() {
            wrapper.classList.add('open');
            focusedIndex = -1;
            if (searchInput) {
                searchInput.value = '';
                filterOptions('');
                setTimeout(function () { searchInput.focus(); }, 50);
            }
            // Scroll selected into view
            var selected = optionsList.querySelector('.selected');
            if (selected) selected.scrollIntoView({ block: 'nearest' });
        }

        function close() {
            wrapper.classList.remove('open');
            focusedIndex = -1;
            clearFocus();
        }

        function isOpen() {
            return wrapper.classList.contains('open');
        }

        function getVisibleOptions() {
            return optionEls.filter(function (el) {
                return !el.classList.contains('hidden');
            });
        }

        function clearFocus() {
            optionEls.forEach(function (el) { el.classList.remove('focused'); });
        }

        function setFocus(index) {
            var visible = getVisibleOptions();
            if (visible.length === 0) return;
            clearFocus();
            focusedIndex = Math.max(0, Math.min(index, visible.length - 1));
            visible[focusedIndex].classList.add('focused');
            visible[focusedIndex].scrollIntoView({ block: 'nearest' });
        }

        function filterOptions(query) {
            var q = query.toLowerCase();
            var anyVisible = false;
            optionEls.forEach(function (el) {
                var text = el.textContent.toLowerCase();
                var show = !q || text.indexOf(q) !== -1;
                el.classList.toggle('hidden', !show);
                if (show) anyVisible = true;
            });
            // Show/hide empty message
            var existing = panel.querySelector('.dropdown-empty');
            if (!anyVisible) {
                if (!existing) {
                    var empty = document.createElement('div');
                    empty.className = 'dropdown-empty';
                    empty.textContent = 'No matches';
                    optionsList.appendChild(empty);
                }
            } else if (existing) {
                existing.remove();
            }
            focusedIndex = -1;
            clearFocus();
        }

        // Event: toggle
        trigger.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (isOpen()) { close(); } else { open(); }
        });

        // Event: keyboard nav
        function handleKeydown(e) {
            if (!isOpen()) {
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    open();
                }
                return;
            }
            var visible = getVisibleOptions();
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    setFocus(focusedIndex + 1);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    setFocus(focusedIndex - 1);
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (focusedIndex >= 0 && visible[focusedIndex]) {
                        visible[focusedIndex].click();
                    }
                    break;
                case 'Escape':
                    e.preventDefault();
                    close();
                    trigger.focus();
                    break;
            }
        }

        trigger.addEventListener('keydown', handleKeydown);
        if (searchInput) {
            searchInput.addEventListener('keydown', handleKeydown);
            searchInput.addEventListener('input', function () {
                filterOptions(searchInput.value);
            });
        }

        // Event: click outside closes
        document.addEventListener('click', function (e) {
            if (isOpen() && !wrapper.contains(e.target)) {
                close();
            }
        });
    }

    function upgradeAll(root) {
        var selects = (root || document).querySelectorAll('select.input:not([data-dropdown-upgraded])');
        selects.forEach(upgradeSelect);
    }

    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { upgradeAll(); });
    } else {
        upgradeAll();
    }

    // Re-init after HTMX swaps
    document.addEventListener('htmx:afterSwap', function (e) {
        upgradeAll(e.detail.target);
    });

    // Refresh an already-upgraded select by destroying and re-creating the wrapper.
    function refreshSelect(sel) {
        var wrapper = sel.previousElementSibling;
        if (wrapper && wrapper.classList.contains('dropdown')) {
            wrapper.remove();
        }
        sel.removeAttribute('data-dropdown-upgraded');
        upgradeSelect(sel);
    }

    // Expose for manual use
    window.HMDropdown = { upgrade: upgradeSelect, upgradeAll: upgradeAll, refresh: refreshSelect };
})();
