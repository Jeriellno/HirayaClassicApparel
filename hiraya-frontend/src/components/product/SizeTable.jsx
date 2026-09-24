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
        <div className="mt-10 animate-fade-in">
            <div className="flex justify-between items-center mb-3">
                <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-white">
                    Size Guide (cm)
                </p>
                <span className="text-[9px] text-zinc-500 italic">*Measured flat-lay</span>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px] uppercase tracking-wider border-t border-zinc-900">
                    <thead>
                        <tr className="text-zinc-500">
                            {headers.map((header) => (
                                <th key={header} className="py-3 font-medium border-b border-zinc-900">
                                    {header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="text-zinc-400">
                        {activeData.map((row) => (
                            <tr key={row.size} className="border-b border-zinc-900 hover:bg-zinc-950 transition-colors">
                                <td className="py-3 font-semibold text-stone-200">{row.size}</td>
                                <td className="py-3 font-normal">{row.col1}</td>
                                <td className="py-3 font-normal">{row.col2}</td>
                                <td className="py-3 font-normal">{row.col3}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <p className="mt-3 text-[10px] text-zinc-500 leading-relaxed">
                Tip: If you're between sizes, we recommend sizing up for a more relaxed, Hiraya-style fit.
            </p>
        </div>
    );
};

export default SizeTable;