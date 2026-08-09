import React, { useEffect, useState } from 'react';
import { db } from './utils';
import type { HistoryEntry } from './utils';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Download, Search } from 'lucide-react';
import Dither from './Dither';

export const DashboardApp: React.FC = () => {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    const data = await db.getHistory();
    setHistory(data.reverse()); // Newest first
  };

  const filtered = history.filter(h => 
    h.ipoName.toLowerCase().includes(search.toLowerCase()) || 
    h.investorName.toLowerCase().includes(search.toLowerCase()) ||
    h.panMasked.toLowerCase().includes(search.toLowerCase())
  );

  const exportCSV = () => {
    const csv = Papa.unparse(filtered);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ipo_history.csv';
    a.click();
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filtered);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "History");
    XLSX.writeFile(wb, "ipo_history.xlsx");
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    autoTable(doc, {
      head: [['IPO Name', 'Investor', 'PAN', 'App No', 'Status', 'Shares', 'Price']],
      body: filtered.map(h => [h.ipoName, h.investorName, h.panMasked, h.applicationNumber, h.allotmentStatus, h.sharesAllotted, h.issuePrice]),
    });
    doc.save('ipo_history.pdf');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0B0F19] to-[#111827] p-8 !text-white relative" style={{ fontFamily: 'Arial, sans-serif' }}>
      
      {/* Interactive WebGL Background */}
      <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100vh', zIndex: 0, pointerEvents: 'none' }}>
        <Dither
          waveColor={[0.1, 0.4, 0.8]} 
          disableAnimation={false}
          enableMouseInteraction={true}
          mouseRadius={0.2}
          colorNum={8}
          pixelSize={4}
          waveAmplitude={0.4}
          waveFrequency={3}
          waveSpeed={0.25}
        />
      </div>

      <div className="max-w-6xl mx-auto relative z-10">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight !text-white m-0">IPO Verification History</h1>
            <p className="text-xs uppercase tracking-widest !text-blue-300 font-semibold mt-1">BSE Automated Checker</p>
          </div>
          <div className="flex gap-3">
            <button onClick={exportCSV} className="group flex items-center gap-2 text-xs font-medium bg-white/5 hover:bg-white/10 !text-blue-200 px-4 py-2 rounded-xl transition-all duration-300 border border-white/5 shadow-lg backdrop-blur-md"><Download size={16}/> CSV</button>
            <button onClick={exportExcel} className="group flex items-center gap-2 text-xs font-medium bg-white/5 hover:bg-white/10 !text-blue-200 px-4 py-2 rounded-xl transition-all duration-300 border border-white/5 shadow-lg backdrop-blur-md"><Download size={16}/> Excel</button>
            <button onClick={exportPDF} className="group flex items-center gap-2 text-xs font-medium bg-white/5 hover:bg-white/10 !text-blue-200 px-4 py-2 rounded-xl transition-all duration-300 border border-white/5 shadow-lg backdrop-blur-md"><Download size={16}/> PDF</button>
          </div>
        </div>

        <div className="glass-card !p-0 overflow-hidden">
          <div className="p-5 border-b border-white/10 flex justify-between items-center bg-black/20">
            <div className="relative w-72">
              <Search className="absolute left-3 top-2.5 !text-gray-400" size={18} />
              <input 
                type="text" 
                placeholder="Search history..." 
                className="pl-10 pr-4 py-2 w-full bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500/50 !text-white text-sm"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <span className="text-sm font-semibold !text-blue-300 tracking-wider">TOTAL: {filtered.length} RECORDS</span>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-black/40 !text-gray-400 text-xs uppercase tracking-wider">
                  <th className="p-5 border-b border-white/10 font-bold">IPO Name</th>
                  <th className="p-5 border-b border-white/10 font-bold">Investor</th>
                  <th className="p-5 border-b border-white/10 font-bold">PAN</th>
                  <th className="p-5 border-b border-white/10 font-bold">App No</th>
                  <th className="p-5 border-b border-white/10 font-bold">Status</th>
                  <th className="p-5 border-b border-white/10 font-bold">Shares</th>
                  <th className="p-5 border-b border-white/10 font-bold">Date Verified</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center !text-gray-400 italic text-sm">No records found.</td></tr>
                ) : (
                  filtered.map(h => (
                    <tr key={h.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors text-sm">
                      <td className="p-5 font-medium !text-gray-200">{h.ipoName}</td>
                      <td className="p-5 font-bold !text-white">{h.investorName}</td>
                      <td className="p-5 !text-gray-400 font-mono text-xs">{h.panMasked}</td>
                      <td className="p-5 !text-gray-300 font-mono text-xs">{h.applicationNumber || '-'}</td>
                      <td className="p-5">
                        <span className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border whitespace-nowrap inline-block text-center ${
                          h.allotmentStatus.includes('Allotted') && h.allotmentStatus !== 'Not Allotted' 
                            ? 'bg-teal-500/10 !text-teal-300 border-teal-500/20 shadow-[0_0_10px_rgba(45,212,191,0.2)]' 
                            : h.allotmentStatus === 'Not Applied' ? 'bg-white/5 !text-gray-400 border-white/10' : 'bg-red-500/10 !text-red-400 border-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.2)]'
                        }`}>
                          {h.allotmentStatus}
                        </span>
                      </td>
                      <td className="p-5 font-bold !text-white">{h.sharesAllotted}</td>
                      <td className="p-5 !text-gray-400 text-xs">{new Date(h.verificationTimestamp).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
