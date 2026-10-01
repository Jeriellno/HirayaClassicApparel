import React from 'react';

const SizeTable = ({ category }) => {
    // 1. Logic para sa Table Headers depende sa category
    const isTop = category?.toLowerCase() === 'tops' || category?.toLowerCase() === 'shirt';
    const headers = isTop 
        ? ['Size', 'Chest', 'Length', 'Shoulder'] 
        : ['Size', 'Waist', 'Hip', 'Inseam'];

    // 2. Data para sa Tops (Example measurements in cm)
    const topSizes = [
        { size: 'S', col1: '104 cm', col2: '68 cm', col3: '44 cm' },
        { size: 'M', col1: '110 cm', col2: '70 cm', col3: '46 cm' },
        { size: 'L', col1: '116 cm', col2: '72 cm', col3: '48 cm' },
        { size: 'XL', col1: '122 cm', col2: '74 cm', col3: '50 cm' },
    ];

    // 3. Data para sa Bottoms (Example measurements in cm)
    const bottomSizes = [
        { size: 'S', col1: '72-76 cm', col2: '96 cm', col3: '70 cm' },
        { size: 'M', col1: '76-80 cm', col2: '100 cm', col3: '72 cm' },
        { size: 'L', col1: '80-84 cm', col2: '104 cm', col3: '74 cm' },
        { size: 'XL', col1: '84-88 cm', col2: '108 cm', col3: '76 cm' },
    ];

    // Piliin kung anong data ang gagamitin base sa category
    const activeData = isTop ? topSizes : bottomSizes;

    return (
        <div className="mt-6">
            <div className="mb-3 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-hiraya-ink">
                    Size Guide (cm)
                </p>
                {/* `italic` was doing nothing except adding a slant to a caption;
                    it is now a plain muted note. */}
                <span className="text-[9px] text-hiraya-ink-muted">*Measured flat-lay</span>
            </div>

            {/*
             * THE TABLE USES THE SYSTEM HAIRLINE, NOT `sand`.
             *
             * Every rule in this table was `border-hiraya-sand`. `sand` is now
             * INDIGO, so the header rule, the row dividers and the outer edge were
             * all being struck in full-strength dark ink — the table read as a
             * set of gate bars rather than as ruled stock. The dividers are the
             * `structure-line` parchment, and the row hover is the accent wash
             * (it was `hover:bg-hiraya-olive` — an indigo flood under dark text,
             * measured 1.00:1, so a hovered row became unreadable).
             */}
            <div className="overflow-x-auto">
                <table className="w-full border-t border-hiraya-structure-line text-left text-[11px] tracking-wider">
                    <thead>
                        <tr className="text-hiraya-ink-muted">
                            {headers.map((header) => (
                                <th key={header} className="border-b border-hiraya-structure-line py-3 font-semibold uppercase">
                                    {header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="text-hiraya-ink-soft">
                        {activeData.map((row) => (
                            <tr key={row.size} className="border-b border-hiraya-structure-line transition-colors hover:bg-hiraya-accent-wash">
                                <td className="py-3 font-semibold text-hiraya-ink">{row.size}</td>
                                <td className="py-3 font-normal">{row.col1}</td>
                                <td className="py-3 font-normal">{row.col2}</td>
                                <td className="py-3 font-normal">{row.col3}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <p className="mt-3 text-[10px] leading-relaxed text-hiraya-ink-muted">
                Tip: If you&apos;re between sizes, we recommend sizing up for a more relaxed, Hiraya-style fit.
            </p>
        </div>
    );
};

export default SizeTable;