import React, { useEffect, useState, useRef, forwardRef } from 'react';
import { db } from './utils';
import type { PanEntry, WorkflowState, HistoryEntry } from './utils';
import { Play, Pause, Trash2, Plus, RefreshCw, Download, Search } from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, wrapEffect } from '@react-three/postprocessing';
import { Effect } from 'postprocessing';
import * as THREE from 'three';



let fetchedKFintech = false;

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
        const hostRoot = document.getElementById('bse-ipo-sidebar-root');
        if (hostRoot && hostRoot.shadowRoot) {
          const shadowContainer = hostRoot.shadowRoot.getElementById('shadow-react-root');
          if (shadowContainer) {
            shadowContainer.scrollTo({ top: shadowContainer.scrollHeight, behavior: 'smooth' });
          }
        } else if (hostRoot) {
          // Fallback if not using shadow dom for some reason
          hostRoot.scrollTo({ top: hostRoot.scrollHeight, behavior: 'smooth' });
        }
      }, 100);
    }
  }, [state.isRunning, state.status]);

  const loadData = async () => {
    setPans(await db.getPans());
    setState(await db.getWorkflowState());
  };

  const fetchIposFromDOM = () => {
    // 1. Try native selects first (BSE, MUFG)
    const selects = Array.from(document.querySelectorAll<HTMLSelectElement>('select'));
    const issueDropdown = selects.find(s => s.options.length > 1);
    if (issueDropdown) {
      const options = Array.from(issueDropdown.options).filter(o => o.value && o.value !== '0' && !o.text.toLowerCase().includes('select'));
      setIpos(options.map(o => ({ id: o.value, name: o.text.trim() })));
      return;
    }

    // 2. KFintech (Material UI Combobox)
    if (window.location.hostname.includes('kfintech')) {
      const options = Array.from(document.querySelectorAll<HTMLElement>('li[role="option"]'));
      if (options.length > 0) {
        if (!fetchedKFintech) {
            setIpos(options.map(o => {
               const id = o.getAttribute('data-value') || o.textContent || '';
               return { id: id.trim(), name: (o.textContent || '').trim() };
            }).filter(o => o.id && !o.name.toLowerCase().includes('select')));
            fetchedKFintech = true;
            // Close the Material UI menu properly
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
            const backdrop = document.querySelector('.MuiBackdrop-root');
            if (backdrop) {
                backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }
            document.body.click();
        }
      } else {
        if (!fetchedKFintech) {
          const combobox = document.querySelector<HTMLElement>('#demo-multiple-name, div[role="combobox"], div[aria-haspopup="listbox"]');
          if (combobox) {
            // Material UI often requires mousedown before click
            combobox.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            combobox.click();
          }
        }
      }
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



export const DashboardApp: React.FC = () => {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadHistory();
    const interval = setInterval(loadHistory, 2000);
    return () => clearInterval(interval);
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


/* eslint-disable react/no-unknown-property */


const waveVertexShader = `
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 modelPosition = modelMatrix * vec4(position, 1.0);
  vec4 viewPosition = viewMatrix * modelPosition;
  gl_Position = projectionMatrix * viewPosition;
}
`;

const waveFragmentShader = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float waveSpeed;
uniform float waveFrequency;
uniform float waveAmplitude;
uniform vec3 waveColor;
uniform vec2 mousePos;
uniform int enableMouseInteraction;
uniform float mouseRadius;

vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec2 fade(vec2 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }

float cnoise(vec2 P) {
  vec4 Pi = floor(P.xyxy) + vec4(0.0,0.0,1.0,1.0);
  vec4 Pf = fract(P.xyxy) - vec4(0.0,0.0,1.0,1.0);
  Pi = mod289(Pi);
  vec4 ix = Pi.xzxz;
  vec4 iy = Pi.yyww;
  vec4 fx = Pf.xzxz;
  vec4 fy = Pf.yyww;
  vec4 i = permute(permute(ix) + iy);
  vec4 gx = fract(i * (1.0/41.0)) * 2.0 - 1.0;
  vec4 gy = abs(gx) - 0.5;
  vec4 tx = floor(gx + 0.5);
  gx = gx - tx;
  vec2 g00 = vec2(gx.x, gy.x);
  vec2 g10 = vec2(gx.y, gy.y);
  vec2 g01 = vec2(gx.z, gy.z);
  vec2 g11 = vec2(gx.w, gy.w);
  vec4 norm = taylorInvSqrt(vec4(dot(g00,g00), dot(g01,g01), dot(g10,g10), dot(g11,g11)));
  g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fade_xy = fade(Pf.xy);
  vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
  return 2.3 * mix(n_x.x, n_x.y, fade_xy.y);
}

const int OCTAVES = 4;
float fbm(vec2 p) {
  float value = 0.0;
  float amp = 1.0;
  float freq = waveFrequency;
  for (int i = 0; i < OCTAVES; i++) {
    value += amp * abs(cnoise(p));
    p *= freq;
    amp *= waveAmplitude;
  }
  return value;
}

float pattern(vec2 p) {
  vec2 p2 = p - time * waveSpeed;
  return fbm(p + fbm(p2)); 
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  uv -= 0.5;
  uv.x *= resolution.x / resolution.y;
  float f = pattern(uv);
  if (enableMouseInteraction == 1) {
    vec2 mouseNDC = (mousePos / resolution - 0.5) * vec2(1.0, -1.0);
    mouseNDC.x *= resolution.x / resolution.y;
    float dist = length(uv - mouseNDC);
    float effect = 1.0 - smoothstep(0.0, mouseRadius, dist);
    f -= 0.5 * effect;
  }
  vec3 col = mix(vec3(0.0), waveColor, f);
  gl_FragColor = vec4(col, 1.0);
}
`;

const ditherFragmentShader = `
precision highp float;
uniform float colorNum;
uniform float pixelSize;
const float bayerMatrix8x8[64] = float[64](
  0.0/64.0, 48.0/64.0, 12.0/64.0, 60.0/64.0,  3.0/64.0, 51.0/64.0, 15.0/64.0, 63.0/64.0,
  32.0/64.0,16.0/64.0, 44.0/64.0, 28.0/64.0, 35.0/64.0,19.0/64.0, 47.0/64.0, 31.0/64.0,
  8.0/64.0, 56.0/64.0,  4.0/64.0, 52.0/64.0, 11.0/64.0,59.0/64.0,  7.0/64.0, 55.0/64.0,
  40.0/64.0,24.0/64.0, 36.0/64.0, 20.0/64.0, 43.0/64.0,27.0/64.0, 39.0/64.0, 23.0/64.0,
  2.0/64.0, 50.0/64.0, 14.0/64.0, 62.0/64.0,  1.0/64.0,49.0/64.0, 13.0/64.0, 61.0/64.0,
  34.0/64.0,18.0/64.0, 46.0/64.0, 30.0/64.0, 33.0/64.0,17.0/64.0, 45.0/64.0, 29.0/64.0,
  10.0/64.0,58.0/64.0,  6.0/64.0, 54.0/64.0,  9.0/64.0,57.0/64.0,  5.0/64.0, 53.0/64.0,
  42.0/64.0,26.0/64.0, 38.0/64.0, 22.0/64.0, 41.0/64.0,25.0/64.0, 37.0/64.0, 21.0/64.0
);

vec3 dither(vec2 uv, vec3 color) {
  vec2 scaledCoord = floor(uv * resolution / pixelSize);
  int x = int(mod(scaledCoord.x, 8.0));
  int y = int(mod(scaledCoord.y, 8.0));
  float threshold = bayerMatrix8x8[y * 8 + x] - 0.25;
  float step = 1.0 / (colorNum - 1.0);
  color += threshold * step;
  float bias = 0.2;
  color = clamp(color - bias, 0.0, 1.0);
  return floor(color * (colorNum - 1.0) + 0.5) / (colorNum - 1.0);
}

void mainImage(in vec4 inputColor, in vec2 uv, out vec4 outputColor) {
  vec2 normalizedPixelSize = pixelSize / resolution;
  vec2 uvPixel = normalizedPixelSize * floor(uv / normalizedPixelSize);
  vec4 color = texture2D(inputBuffer, uvPixel);
  color.rgb = dither(uv, color.rgb);
  outputColor = color;
}
`;

class RetroEffectImpl extends Effect {
  constructor() {
    const uniforms = new Map([
      ['colorNum', new THREE.Uniform(4.0)],
      ['pixelSize', new THREE.Uniform(2.0)]
    ]);
    super('RetroEffect', ditherFragmentShader, { uniforms });
    // @ts-ignore - postprocessing types mark uniforms as readonly but we need to assign it or use the parent's
    this.uniforms = uniforms;
  }
  set colorNum(v: number) {
    this.uniforms.get('colorNum')!.value = v;
  }
  get colorNum() {
    return this.uniforms.get('colorNum')!.value;
  }
  set pixelSize(v: number) {
    this.uniforms.get('pixelSize')!.value = v;
  }
  get pixelSize() {
    return this.uniforms.get('pixelSize')!.value;
  }
}

const WrappedRetro = wrapEffect(RetroEffectImpl);

const RetroEffect = forwardRef<any, any>((props, ref) => {
  const { colorNum, pixelSize } = props;
  return <WrappedRetro ref={ref} colorNum={colorNum} pixelSize={pixelSize} />;
});
RetroEffect.displayName = 'RetroEffect';

function DitheredWaves({
  waveSpeed,
  waveFrequency,
  waveAmplitude,
  waveColor,
  colorNum,
  pixelSize,
  disableAnimation,
  enableMouseInteraction,
  mouseRadius
}: any) {
  const mesh = useRef<any>(null);
  const mouseRef = useRef(new THREE.Vector2());
  const { viewport, size, gl } = useThree();

  const waveUniformsRef = useRef({
    time: new THREE.Uniform(0),
    resolution: new THREE.Uniform(new THREE.Vector2(0, 0)),
    waveSpeed: new THREE.Uniform(waveSpeed),
    waveFrequency: new THREE.Uniform(waveFrequency),
    waveAmplitude: new THREE.Uniform(waveAmplitude),
    waveColor: new THREE.Uniform(new THREE.Color(...waveColor)),
    mousePos: new THREE.Uniform(new THREE.Vector2(0, 0)),
    enableMouseInteraction: new THREE.Uniform(enableMouseInteraction ? 1 : 0),
    mouseRadius: new THREE.Uniform(mouseRadius)
  });

  useEffect(() => {
    const dpr = gl.getPixelRatio();
    const w = Math.floor(size.width * dpr),
      h = Math.floor(size.height * dpr);
    const res = waveUniformsRef.current.resolution.value;
    if (res.x !== w || res.y !== h) {
      res.set(w, h);
    }
  }, [size, gl]);

  const prevColor = useRef([...waveColor]);
  useFrame((_, delta) => {
    const u = waveUniformsRef.current;

    if (!disableAnimation) {
      u.time.value += delta;
    }

    if (u.waveSpeed.value !== waveSpeed) u.waveSpeed.value = waveSpeed;
    if (u.waveFrequency.value !== waveFrequency) u.waveFrequency.value = waveFrequency;
    if (u.waveAmplitude.value !== waveAmplitude) u.waveAmplitude.value = waveAmplitude;

    if (!prevColor.current.every((v, i) => v === waveColor[i])) {
      u.waveColor.value.set(...waveColor);
      prevColor.current = [...waveColor];
    }

    u.enableMouseInteraction.value = enableMouseInteraction ? 1 : 0;
    u.mouseRadius.value = mouseRadius;

    if (enableMouseInteraction) {
      u.mousePos.value.copy(mouseRef.current);
    }
  });

  useEffect(() => {
    const handleGlobalPointerMove = (e: PointerEvent) => {
      if (!enableMouseInteraction) return;
      const rect = gl.domElement.getBoundingClientRect();
      const dpr = gl.getPixelRatio();
      mouseRef.current.set((e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr);
    };

    window.addEventListener('pointermove', handleGlobalPointerMove);
    return () => window.removeEventListener('pointermove', handleGlobalPointerMove);
  }, [enableMouseInteraction, gl]);

  return (
    <>
      <mesh ref={mesh} scale={[viewport.width, viewport.height, 1]}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          vertexShader={waveVertexShader}
          fragmentShader={waveFragmentShader}
          uniforms={waveUniformsRef.current}
        />
      </mesh>

      <EffectComposer>
        <RetroEffect colorNum={colorNum} pixelSize={pixelSize} />
      </EffectComposer>
    </>
  );
}

export function Dither({
  waveSpeed = 0.05,
  waveFrequency = 3,
  waveAmplitude = 0.3,
  waveColor = [0.5, 0.5, 0.5],
  colorNum = 4,
  pixelSize = 2,
  disableAnimation = false,
  enableMouseInteraction = true,
  mouseRadius = 1
}: any) {
  return (
    <Canvas
      style={{ width: '100%', height: '100%', position: 'relative' }}
      camera={{ position: [0, 0, 6] }}
      dpr={1}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <DitheredWaves
        waveSpeed={waveSpeed}
        waveFrequency={waveFrequency}
        waveAmplitude={waveAmplitude}
        waveColor={waveColor}
        colorNum={colorNum}
        pixelSize={pixelSize}
        disableAnimation={disableAnimation}
        enableMouseInteraction={enableMouseInteraction}
        mouseRadius={mouseRadius}
      />
    </Canvas>
  );
}
