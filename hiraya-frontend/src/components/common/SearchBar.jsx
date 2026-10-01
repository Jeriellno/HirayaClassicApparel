import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';

/**
 * SHOP SEARCH — moved out of the navbar and into the Shop page itself.
 *
 * It used to be a navbar affordance: a collapsed icon that expanded into an input
 * styled for the navy nav band, which then navigated to `/shop?search=…`. That
 * made the only way to filter the collection to be from somewhere else, and the
 * control's styling belonged to a surface it no longer lives on.
 *
 * Now the search lives where the results are. It is a plain, always-visible field
 * that reads and writes the SAME `?search=` param the Shop page filters on, so the
 * URL stays the single source of truth:
 *   - the value is local state seeded from the URL, so typing stays instant (no
 *     re-filter of the whole catalog on every keystroke);
 *   - it is pushed to the URL on submit and debounced while typing, so a shared or
 *     bookmarked URL always reproduces the same grid;
 *   - clearing the field clears the param — the same thing Shop's "Clear Filter"
 *     badge does — so the two controls can never disagree.
 */
const SearchBar = ({ className = '' }) => {
    const [searchParams, setSearchParams] = useSearchParams();
    const urlQuery = searchParams.get('search') || '';

    const [value, setValue] = useState(urlQuery);

    // Re-sync local state when the param changes from the OUTSIDE (Shop's "Clear
    // Filter" badge, or a shared link) — otherwise the field would keep showing
    // a term the grid is no longer filtering by.
    useEffect(() => {
        setValue(urlQuery);
    }, [urlQuery]);

    const commit = (next) => {
        const trimmed = next.trim();
        const params = new URLSearchParams(searchParams);
        if (trimmed) {
            params.set('search', trimmed);
        } else {
            params.delete('search');
        }
        // replace, not push: a shopper typing "linen" should not fill the back
        // button with one history entry per debounced keystroke.
        setSearchParams(params, { replace: true });
    };

    // Debounce the URL write so the catalog is not re-filtered on every character.
    useEffect(() => {
        if (value === urlQuery) return undefined;
        const timer = setTimeout(() => commit(value), 350);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                commit(value);
            }}
            role="search"
            className={`relative flex w-full items-center ${className}`}
        >
            <Search
                size={16}
                className="pointer-events-none absolute left-3.5 text-hiraya-ink-muted"
                aria-hidden="true"
            />
            <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Search by garment name..."
                aria-label="Search garments by name"
                className="w-full rounded-full border border-hiraya-ink/10 bg-hiraya-surface-sunken/55 py-3 pl-10 pr-10 text-xs tracking-wide text-hiraya-ink shadow-neu-inset outline-none transition placeholder:text-hiraya-ink-muted focus:border-hiraya-accent-soft focus:bg-hiraya-surface-raised focus:ring-2 focus:ring-hiraya-accent/20"
            />
            {value && (
                <button
                    type="button"
                    onClick={() => setValue('')}
                    className="absolute right-3 cursor-pointer rounded-sm p-0.5 text-hiraya-ink-muted transition-colors hover:text-hiraya-accent"
                    aria-label="Clear search"
                >
                    <X size={15} />
                </button>
            )}
        </form>
    );
};

export default SearchBar;