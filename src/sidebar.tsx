import React, { useEffect, useState } from 'react';
import { db } from './utils';
import type { PanEntry, WorkflowState } from './utils';
import { Play, Pause, Trash2, Plus, RefreshCw } from 'lucide-react';

import { DashboardApp } from './dashboard';
import Dither from './Dither';

export const SidebarApp: React.FC = () => {
  const [pans, setPans] = useState<PanEntry[]>([]);
  const [newPanName, setNewPanName] = useState('');
  const [newPanNumber, setNewPanNumber] = useState('');
  
  const [ipos, setIpos] = useState<{ id: string, name: string }[]>([]);
  const [selectedIpos, setSelectedIpos] = useState<string[]>([]);
  
  const [state, setState] = useState<WorkflowState>({ isRunning: false, targetIpos: [], ipoIndex: 0, panIndex: 0, status: 'Idle' });
  const [showDashboard, setShowDashboard] = useState(false);

  useEffect(() => {
    loadData();
    
    // Auto-select "Equity" robustly with retries in case it renders late
    let retries = 0;
    const selectEquity = () => {
      const equityRadio = document.querySelector<HTMLInputElement>('input[id*="chkType_0"], input[value="Equity"], input[type="radio"]:first-of-type');
      if (equityRadio) {
        if (!equityRadio.checked) {
          equityRadio.click();
          equityRadio.dispatchEvent(new Event('change', { bubbles: true }));
          equityRadio.dispatchEvent(new Event('click', { bubbles: true }));
        }
      } else if (retries < 5) {
        retries++;
        setTimeout(selectEquity, 500);
      }
    };
    selectEquity();

    fetchIposFromDOM();
    const intervalIpos = setInterval(fetchIposFromDOM, 2000);
    const intervalData = setInterval(loadData, 500);
    return () => {
       clearInterval(intervalIpos);
       clearInterval(intervalData);
    };
  }, []);

  useEffect(() => {
    if (state.isRunning) {
      setTimeout(() => {
        const root = document.getElementById('bse-ipo-sidebar-root');
        if (root) {
          root.scrollTo({ top: root.scrollHeight, behavior: 'smooth' });
        }
      }, 100);
    }
  }, [state.isRunning, state.status]);

  const loadData = async () => {
    setPans(await db.getPans());
    setState(await db.getWorkflowState());
  };

  const fetchIposFromDOM = () => {
    // Sometimes the select might be hidden but populated, so we remove the width check
    const selects = Array.from(document.querySelectorAll<HTMLSelectElement>('select'));
    const issueDropdown = selects.find(s => s.options.length > 1);
    if (issueDropdown) {
      const options = Array.from(issueDropdown.options).filter(o => o.value && o.value !== '0' && !o.text.toLowerCase().includes('select'));
      setIpos(options.map(o => ({ id: o.value, name: o.text.trim() })));
    }
  };

  const addPan = async () => {
    if (!newPanName || !newPanNumber) return;
    const newPan = { id: crypto.randomUUID(), name: newPanName, pan: newPanNumber.toUpperCase() };
    await db.savePans([...pans, newPan]);
    setNewPanName('');
    setNewPanNumber('');
    loadData();
  };

  const removePan = async (id: string) => {
    await db.savePans(pans.filter(p => p.id !== id));
    loadData();
  };

  const toggleIpo = (id: string) => {
    setSelectedIpos(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const startWorkflow = async () => {
    if (selectedIpos.length === 0 || pans.length === 0) return alert('Select at least one IPO and add at least one PAN.');
    const targets = ipos.filter(i => selectedIpos.includes(i.id));
    await db.setWorkflowState({ isRunning: true, targetIpos: targets, ipoIndex: 0, panIndex: 0, status: 'Starting...', isAwaitingResult: false });
    window.location.href = window.location.origin + window.location.pathname + '?r=' + Date.now(); // Force GET request to clear any previous POST results
  };

  const stopWorkflow = async () => {
    await db.setWorkflowState({ isRunning: false, status: 'Stopped' });
    loadData();
  };

  const toggleDashboard = (show: boolean) => {
    const container = document.getElementById('bse-ipo-sidebar-root');
    if (container) {
       container.style.width = show ? '100vw' : '400px';
    }
    setShowDashboard(show);
  };

  if (showDashboard) {
    return (
      <div className="relative w-full h-full">
        <DashboardApp />
        <button 
          onClick={() => toggleDashboard(false)} 
          className="absolute top-6 right-6 bg-slate-800 text-white px-4 py-2 rounded-lg font-bold shadow-lg hover:bg-slate-700 border border-slate-600 transition-colors z-50">
          Close Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col min-h-full bg-gradient-to-b from-[#0B0F19] to-[#111827] !text-white shadow-2xl relative" style={{ fontFamily: 'Arial, sans-serif' }}>
      
      {/* Interactive WebGL Background */}
      <div style={{ position: 'fixed', top: 0, right: 0, width: '400px', height: '100vh', zIndex: 0 }}>
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

      {/* Decorative Glows (moved below Dither if Dither has its own background, but we can keep them for layered effects) */}
      <div className="absolute top-[-50px] left-[-50px] w-48 h-48 bg-blue-500/20 rounded-full blur-[80px] pointer-events-none z-0"></div>
      <div className="absolute bottom-[-50px] right-[-50px] w-48 h-48 bg-teal-500/10 rounded-full blur-[80px] pointer-events-none z-0"></div>

      <div className="flex items-center justify-between mb-6 relative z-10">
        <div>
           <h2 className="text-2xl font-extrabold tracking-tight !text-white" style={{ color: 'white', margin: 0, padding: 0 }}>
             BSE Checker
           </h2>
           <p className="text-[10px] uppercase tracking-widest !text-blue-300 font-semibold mt-0.5" style={{ color: '#93c5fd', margin: 0 }}>Automated IPO System</p>
        </div>
        <div className="flex flex-col gap-2 items-end">
          <button onClick={() => toggleDashboard(true)} className="group flex items-center justify-center gap-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 !text-blue-200 px-4 py-2 rounded-xl transition-all duration-300 border border-white/5 shadow-lg backdrop-blur-md w-full">
            Dashboard
          </button>
          <a href="https://www.investorgain.com/report/live-ipo-gmp/331/all/" target="_blank" rel="noopener noreferrer" className="group flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider bg-purple-500/10 hover:bg-purple-500/20 !text-purple-300 px-3 py-1.5 rounded-lg transition-all duration-300 border border-purple-500/20 shadow-lg backdrop-blur-md w-full text-center hover:scale-105">
            View Live GMP
          </a>
        </div>
      </div>

      <div className="mb-6 glass-card">
        <h3 className="text-sm font-semibold mb-4 !text-white flex items-center gap-2.5" style={{ color: 'white', margin: '0 0 16px 0' }}>
          <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)]"></span> 
          Manage PANs
        </h3>
        <div className="flex gap-2 mb-4" style={{ display: 'flex', width: '100%' }}>
          <input style={{ minWidth: 0, margin: 0, padding: '8px 12px', width: '50%', color: 'white' }} className="bg-black/20 border border-white/10 text-sm rounded-xl focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50 outline-none" placeholder="Name" value={newPanName} onChange={e => setNewPanName(e.target.value)} />
          <input style={{ minWidth: 0, margin: 0, padding: '8px 12px', width: '30%', color: 'white' }} className="bg-black/20 border border-white/10 text-sm rounded-xl uppercase focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50 outline-none font-mono tracking-wider" placeholder="PAN" maxLength={10} value={newPanNumber} onChange={e => setNewPanNumber(e.target.value)} />
          <button style={{ margin: 0, padding: '10px', width: '20%' }} onClick={addPan} className="btn-special bg-blue-600/90 !text-white rounded-xl shadow-[0_0_15px_rgba(37,99,235,0.4)] flex justify-center items-center"><Plus size={18} strokeWidth={2.5} /></button>
        </div>
        <div className="pr-2 space-y-2.5">
          {pans.length === 0 && <p className="text-xs !text-gray-400 italic text-center py-3">No PANs saved yet.</p>}
          {pans.map(p => (
            <div key={p.id} className="flex justify-between items-center text-sm p-3 bg-white/[0.02] rounded-xl border border-white/[0.04] group hover:bg-white/[0.04] hover:border-white/10 transition-all duration-300">
              <span className="font-semibold !text-white tracking-wide" style={{ color: 'white' }}>{p.name} <span className="!text-gray-400 font-mono text-xs ml-2 tracking-widest" style={{ color: '#9ca3af' }}>{p.pan.substring(0, 2) + '****' + p.pan.substring(8)}</span></span>
              <button onClick={() => removePan(p.id)} className="!text-gray-400 hover:!text-red-400 transition-colors opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/10 rounded-md"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-6 glass-card flex flex-col">
        <h3 className="text-sm font-semibold mb-4 !text-white flex items-center justify-between" style={{ color: 'white', margin: '0 0 16px 0' }}>
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-teal-400 shadow-[0_0_10px_rgba(45,212,191,0.8)]"></span> 
            Available IPOs
          </div>
          <button onClick={fetchIposFromDOM} className="!text-gray-400 hover:!text-teal-400 transition-colors p-1.5 hover:bg-white/5 rounded-lg"><RefreshCw size={15} /></button>
        </h3>
        <div className="pr-3 space-y-2">
          {ipos.length === 0 && <p className="text-xs !text-gray-400 italic text-center py-6">Scanning page for IPOs...</p>}
          {ipos.map(ipo => (
            <label key={ipo.id} className="flex items-center gap-3.5 text-sm cursor-pointer group bg-black/10 hover:bg-white/[0.04] p-3 rounded-xl transition-all border border-transparent hover:border-white/[0.05]">
              <div className="relative flex items-center justify-center w-5 h-5">
                 <input type="checkbox" className="peer appearance-none w-5 h-5 rounded-md border-2 border-white/20 checked:border-teal-400 checked:bg-teal-500/20 transition-all cursor-pointer" checked={selectedIpos.includes(ipo.id)} onChange={() => toggleIpo(ipo.id)} style={{ margin: 0 }} />
                 <svg className="absolute w-3 h-3 !text-teal-400 opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" viewBox="0 0 14 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M1 5L4.5 8.5L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                 </svg>
              </div>
              <span className="leading-snug !text-gray-300 group-hover:!text-white transition-colors font-medium" style={{ color: '#d1d5db' }}>{ipo.name}</span>
            </label>
          ))}
        </div>
      </div>

      <div id="status-panel" className="mt-auto glass-card border-t border-white/[0.08] shadow-[0_-10px_40px_rgba(0,0,0,0.3)]">
        <div className="flex items-center justify-between mb-4">
           <span className="text-[11px] font-bold uppercase tracking-widest !text-gray-400" style={{ color: '#9ca3af' }}>Status</span>
           <span className="text-xs font-semibold !text-teal-300 bg-teal-500/10 px-2.5 py-1 rounded-md border border-teal-500/20">{state.status === 'Idle' ? 'Ready' : state.status.includes('Waiting') ? 'Awaiting Data...' : state.status}</span>
        </div>
        
        {state.isRunning ? (
          <button onClick={stopWorkflow} className="w-full bg-red-500/10 !text-red-400 border border-red-500/30 p-4 rounded-xl hover:bg-red-500 hover:!text-white transition-all duration-300 flex items-center justify-center gap-2.5 font-bold tracking-wide shadow-[0_0_20px_rgba(239,68,68,0.15)] hover:shadow-[0_0_30px_rgba(239,68,68,0.3)]">
            <Pause size={18} fill="currentColor" /> STOP EXECUTION
          </button>
        ) : (
          <button onClick={startWorkflow} className="btn-special w-full bg-gradient-to-r from-teal-500 to-blue-500 !text-white border-0 p-4 rounded-xl flex items-center justify-center gap-2.5 font-bold tracking-wide shadow-[0_0_20px_rgba(20,184,166,0.3)]" style={{ color: 'white' }}>
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></div>
            <Play size={18} fill="currentColor" className="relative z-10" /> 
            <span className="relative z-10">START VERIFICATION</span>
          </button>
        )}
      </div>
    </div>
  );
};
