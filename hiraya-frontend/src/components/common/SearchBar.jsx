import React from 'react';
import { Search, X } from 'lucide-react';

const SearchBar = ({ 
    isOpen, 
    setIsOpen, 
    query, 
    setQuery, 
    onSubmit, 
    isScrolled 
}) => {
    if (!isOpen) {
        return (
            <button 
                onClick={() => setIsOpen(true)}
                className="hidden sm:flex items-center justify-center w-10 h-10 rounded-full border border-transparent text-hiraya-ink hover:bg-hiraya-cream/60 hover:text-hiraya-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CB997E]/70 transition-all"
                title="Search"
            >
                <Search size={22} strokeWidth={1.5} />
            </button>
        );
    }

    return (
        <form
            onSubmit={onSubmit}
            className={`flex items-center gap-2 border px-3 py-2 rounded-full shadow-md transition-all duration-300 ${
                isScrolled
                    ? 'bg-hiraya-cream text-hiraya-charcoal border-hiraya-gold/50'
                    : 'bg-hiraya-cream-deep/90 text-hiraya-ink border-hiraya-olive/20 backdrop-blur-xl'
            }`}
        >
            <Search size={18} className={isScrolled ? 'text-hiraya-sand' : 'text-hiraya-ink'} />
            <input
                type="text"
                placeholder="Search wardrobe..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
                className="bg-transparent text-[13px] outline-none tracking-wide w-32 md:w-48 placeholder:text-hiraya-ink"
            />
            <button
                type="button"
                onClick={() => setIsOpen(false)}
                className={`p-1 rounded-full ${isScrolled ? 'text-hiraya-ink hover:text-hiraya-olive hover:bg-hiraya-olive/5' : 'text-hiraya-ink hover:text-hiraya-ink hover:bg-hiraya-cream/60'}`}
                aria-label="Close search"
            >
                <X size={16} />
            </button>
        </form>
    );
};

export default SearchBar;