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
                className="hidden sm:block hover:text-stone-200 hover:scale-110 transition-all"
                title="Search"
            >
                <Search size={22} strokeWidth={1.5} />
            </button>
        );
    }

    return (
        <form 
            onSubmit={onSubmit} 
            className={`flex items-center gap-2 border border-stone-300/40 px-4 py-1.5 rounded-full shadow-md transition-all duration-300 ${
                isScrolled ? 'bg-white text-hiraya-charcoal' : 'bg-white/10 backdrop-blur-md text-white'
            }`}
        >
            <Search size={18} className="text-stone-200" />
            <input
                type="text"
                placeholder="Search wardrobe..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
                className="bg-transparent text-[13px] outline-none tracking-wide w-36 md:w-56 placeholder:text-gray-400"
            />
            <button 
                type="button" 
                onClick={() => setIsOpen(false)}
                className={isScrolled ? 'text-gray-400 hover:text-black' : 'text-gray-300 hover:text-white'}
            >
                <X size={16} />
            </button>
        </form>
    );
};

export default SearchBar;