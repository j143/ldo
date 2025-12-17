import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';
import { Play, RotateCcw, Zap, Activity, Waves, Thermometer, Settings, Download, AlertCircle, CheckCircle, Smartphone } from 'lucide-react';

// --- VISUAL STYLE CONSTANTS ---
// "Podcast Studio" / Neo-Brutalist Palette
const COLORS = {
  bg: 'bg-[#121217]', // Very dark grey/blue
  panel: 'bg-[#1E1E26]', // Slightly lighter panel
  surface: 'bg-[#2A2A35]', // Element surface
  primary: '#8B5CF6', // Violet
  primaryBg: 'bg-violet-500',
  secondary: '#3B82F6', // Blue
  secondaryBg: 'bg-blue-500',
  accent: '#F97316', // Orange
  accentBg: 'bg-orange-500',
  success: '#10B981', // Emerald
  danger: '#EF4444', // Red
  textMain: 'text-slate-100',
  textMuted: 'text-slate-400',
  border: 'border-black',
};

// Common Styles for "Squashy" Tactility
const CARD_STYLE = `${COLORS.panel} border-2 border-black rounded-xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] p-4`;
const BUTTON_STYLE = `transition-all active:translate-y-1 active:shadow-none border-2 border-black rounded-lg font-bold px-4 py-2 flex items-center justify-center gap-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]`;
const INPUT_STYLE = `w-full bg-[#121217] text-white border-2 border-slate-700 rounded-lg p-2 focus:border-violet-500 focus:outline-none transition-colors`;
const LABEL_STYLE = `text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 block`;

// --- SIMULATION ENGINE (Approximated) ---

const simulateLDO = (params) => {
  const { vin, voutTarget, loadCurrent, cout, esr, rcomp, ccomp, temp } = params;
  
  // 1. Basic Physics Derivations
  const loadRes = voutTarget / (Math.max(loadCurrent, 1) / 1000); // Ohms
  const outputPole = 1 / (2 * Math.PI * (cout * 1e-6) * loadRes);
  const esrZero = 1 / (2 * Math.PI * (cout * 1e-6) * (esr / 1000));
  const dominantPole = 1 / (2 * Math.PI * (rcomp * 1000) * (ccomp * 1e-12)); // Internal comp
  
  // Loop Gain (DC) rough approximation based on Load
  const dcGainDb = 80 - (loadCurrent / 500) * 20; 

  // 2. Bode Plot Generation
  const bodeData = [];
  let crossOverFreq = 0;
  let phaseMargin = 0;
  
  // Frequency sweep 1kHz to 100MHz
  for (let i = 0; i <= 50; i++) {
    const f = Math.pow(10, 3 + (i / 50) * 5); // 10^3 to 10^8
    
    // Magnitude Model: DC Gain - poles - zeros
    // Simplified transfer function logic for visualization
    let mag = dcGainDb;
    mag -= 20 * Math.log10(Math.sqrt(1 + Math.pow(f / dominantPole, 2)));
    mag -= 20 * Math.log10(Math.sqrt(1 + Math.pow(f / outputPole, 2)));
    mag += 20 * Math.log10(Math.sqrt(1 + Math.pow(f / esrZero, 2)));

    // Phase Model
    let phase = 180; // Start at 180 stability ref
    phase -= (Math.atan(f / dominantPole) * 180) / Math.PI;
    phase -= (Math.atan(f / outputPole) * 180) / Math.PI;
    phase += (Math.atan(f / esrZero) * 180) / Math.PI;

    // Detect Crossover
    if (mag <= 0 && crossOverFreq === 0) {
      crossOverFreq = f;
      phaseMargin = phase; // Phase margin at 0dB crossing
    }

    bodeData.push({ freq: f, mag, phase: phase < 0 ? phase + 360 : phase });
  }

  // 3. Transient Response (Damped Harmonic Oscillator approx)
  const transientData = [];
  const dampingRatio = phaseMargin / 100; // Heuristic: PM 60deg ~ 0.6 damping
  const naturalFreq = crossOverFreq * 2 * Math.PI; 
  const dt = 5e-6 / 100; // 5us total time

  let maxOvershoot = 0;
  let maxDroop = 0;
  const steadyState = voutTarget;
  
  // Simulate load step at t=1us
  for (let i = 0; i < 100; i++) {
    const t = i * dt;
    let val = steadyState;

    if (t > 1e-6) {
      const t_step = t - 1e-6;
      // Step response approx
      if (dampingRatio < 1) {
        const wd = naturalFreq * Math.sqrt(1 - dampingRatio * dampingRatio);
        const envelope = Math.exp(-dampingRatio * naturalFreq * t_step);
        // Load step causes droop/overshoot proportional to loadCurrent change
        const scale = (loadCurrent / 500) * 0.2; // Max 200mV deviation
        val = steadyState - scale * (1 - envelope * (Math.cos(wd * t_step) + (dampingRatio/Math.sqrt(1-dampingRatio**2)) * Math.sin(wd * t_step)));
      } else {
        // Overdamped
        val = steadyState - ((loadCurrent/500)*0.1) * (1 - Math.exp(-naturalFreq * t_step));
      }
    }
    
    // Add some noise based on temp
    const noise = (Math.random() - 0.5) * (temp / 125) * 0.002;
    val += noise;

    if (t > 1e-6) {
        if (val > steadyState) maxOvershoot = Math.max(maxOvershoot, (val - steadyState) * 1000);
        if (val < steadyState) maxDroop = Math.max(maxDroop, (steadyState - val) * 1000);
    }
    
    transientData.push({ time: t * 1e6, vout: val });
  }

  // 4. PSRR Generation
  const psrrData = [];
  for (let i = 0; i <= 20; i++) {
    const f = Math.pow(10, 3 + (i / 20) * 5);
    // PSRR degrades with frequency, improves with loop gain
    let psrr = dcGainDb - 20 * Math.log10(1 + f/1000); 
    if (psrr < 0) psrr = 0;
    psrrData.push({ freq: f, psrr });
  }

  const psrr1MHz = psrrData.find(d => d.freq >= 1e6)?.psrr || 0;

  // 5. KPIs
  const riseTime = 0.35 / (crossOverFreq || 1); 
  const pass = phaseMargin > 45 && maxOvershoot < 50 && maxDroop < 100;

  return {
    bodeData,
    transientData,
    psrrData,
    kpis: {
      phaseMargin: phaseMargin.toFixed(1),
      crossOverFreq: (crossOverFreq / 1e6).toFixed(2), // MHz
      overshoot: maxOvershoot.toFixed(1), // mV
      droop: maxDroop.toFixed(1), // mV
      psrr1MHz: psrr1MHz.toFixed(1),
      pass
    }
  };
};

// --- SUB-COMPONENTS ---

const RangeControl = ({ label, value, min, max, step, unit, onChange, color = "violet" }) => {
  // Map color names to hex values for standard CSS accent-color
  const colorMap = {
    violet: "#8B5CF6",
    blue: "#3B82F6",
    orange: "#F97316",
    emerald: "#10B981"
  };

  return (
    <div className="mb-4">
      <div className="flex justify-between items-end mb-1">
        <label className={LABEL_STYLE}>{label}</label>
        <span className={`font-mono text-sm font-bold ${COLORS.textMain}`}>
          {value} <span className="text-xs text-slate-500">{unit}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ accentColor: colorMap[color] }}
        className={`w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer`}
      />
    </div>
  );
};

const KPITag = ({ label, value, unit, status = "neutral" }) => {
  const statusColors = {
    neutral: "bg-slate-700 border-slate-600",
    success: "bg-emerald-900 border-emerald-500 text-emerald-100",
    warning: "bg-amber-900 border-amber-500 text-amber-100",
    danger: "bg-red-900 border-red-500 text-red-100",
  };

  return (
    <div className={`flex flex-col p-2 rounded border ${statusColors[status]} min-w-[100px]`}>
      <span className="text-[10px] uppercase opacity-70 mb-1">{label}</span>
      <span className="text-xl font-mono font-bold">
        {value}<span className="text-sm opacity-70 ml-1">{unit}</span>
      </span>
    </div>
  );
};

// SVG Circuit Visualization (Explorable Metaphor)
const CircuitViz = ({ params, isSimulating }) => {
    // Dynamic styles based on state
    const compColor = params.rcomp > 30 ? "#EF4444" : "#8B5CF6";
    const capSize = 20 + (params.cout / 50) * 20;

    return (
      <div className="relative w-full h-48 bg-[#18181b] rounded-lg overflow-hidden flex items-center justify-center border-2 border-slate-800">
        <svg viewBox="0 0 400 200" className="w-full h-full">
            {/* Grid Background */}
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#2A2A35" strokeWidth="1"/>
            </pattern>
            <rect width="400" height="200" fill="url(#grid)" />

            {/* Input Power */}
            <g transform="translate(40, 100)">
                <circle cx="0" cy="0" r="15" fill="#3B82F6" opacity="0.2" />
                <text x="0" y="5" textAnchor="middle" fill="#3B82F6" fontSize="10" fontWeight="bold">VIN</text>
                <text x="0" y="25" textAnchor="middle" fill="#64748b" fontSize="8">{params.vin}V</text>
            </g>

            {/* Main Pass Transistor (Blocky Metaphor) */}
            <g transform="translate(140, 100)">
                <rect x="-20" y="-30" width="40" height="60" rx="8" fill="#2A2A35" stroke={COLORS.primary} strokeWidth="2" />
                <path d="M -20 0 L -80 0" stroke="#475569" strokeWidth="3" /> {/* Wire to Vin */}
                <path d="M 20 0 L 120 0" stroke="#475569" strokeWidth="3" />  {/* Wire to Vout */}
                
                {/* Gate Control Line (Animated) */}
                <path d="M 0 -30 L 0 -60" stroke="#475569" strokeWidth="2" strokeDasharray="4 2" />
                <circle cx="0" cy="-60" r="4" fill={isSimulating ? "#F97316" : "#475569"}>
                    {isSimulating && <animate attributeName="opacity" values="1;0.5;1" dur="0.5s" repeatCount="indefinite" />}
                </circle>
            </g>

            {/* Error Amp / Compensation */}
            <g transform="translate(140, 40)">
                 <path d="M 0 0 L 0 30" stroke="#475569" strokeWidth="2" />
                 <rect x="-25" y="-20" width="50" height="30" rx="4" fill="#2A2A35" stroke={compColor} strokeWidth="2" />
                 <text x="0" y="0" textAnchor="middle" fill="white" fontSize="8">Error Amp</text>
            </g>

            {/* Output Cap (Variable Size Metaphor) */}
            <g transform="translate(260, 100)">
                <line x1="0" y1="0" x2="0" y2="40" stroke="#475569" strokeWidth="3" />
                <rect x="-10" y="40" width="20" height={capSize} rx="4" fill="#3B82F6" opacity="0.3" stroke="#3B82F6" />
                <text x="30" y="60" fill="#94a3b8" fontSize="10">Cout: {params.cout}µF</text>
                <text x="30" y="75" fill="#94a3b8" fontSize="10">ESR: {params.esr}mΩ</text>
            </g>

            {/* Load (Resistor Metaphor) */}
            <g transform="translate(340, 100)">
                <path d="M -80 0 L 0 0" stroke="#475569" strokeWidth="3" />
                <path d="M 0 0 L 0 40 L -10 45 L 10 55 L -10 65 L 10 75 L 0 80" fill="none" stroke="#F97316" strokeWidth="2" />
                <text x="0" y="100" textAnchor="middle" fill="#F97316" fontSize="10">{params.loadCurrent}mA</text>
            </g>
        </svg>
      </div>
    );
}

// --- MAIN APP COMPONENT ---

export default function LdoSimulator() {
  // State
  const [params, setParams] = useState({
    vin: 3.3,
    voutTarget: 1.8,
    loadCurrent: 100, // mA
    cout: 10, // uF
    esr: 10, // mOhm
    rcomp: 20, // kOhm
    ccomp: 100, // pF
    temp: 25, // C
  });

  const [simResults, setSimResults] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [activeTab, setActiveTab] = useState('transient');

  // Logic
  const runSimulation = useCallback(() => {
    setIsSimulating(true);
    // Artificial delay for "processing" feel
    setTimeout(() => {
        const results = simulateLDO(params);
        setSimResults(results);
        setIsSimulating(false);
    }, 400);
  }, [params]);

  // Debounce simulation on param change
  useEffect(() => {
    const timer = setTimeout(runSimulation, 500);
    return () => clearTimeout(timer);
  }, [runSimulation]);

  // Presets
  const applyPreset = (type) => {
    const presets = {
      nominal: { cout: 10, esr: 10, loadCurrent: 100, rcomp: 20 },
      unstable: { cout: 1, esr: 1, loadCurrent: 10, rcomp: 50 }, // Low phase margin
      heavy: { cout: 47, esr: 20, loadCurrent: 500, rcomp: 10 },
    };
    if (presets[type]) setParams(p => ({ ...p, ...presets[type] }));
  };

  return (
    <div className={`min-h-screen ${COLORS.bg} ${COLORS.textMain} font-sans p-4 md:p-8`}>
      {/* HEADER */}
      <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
            <h1 className="text-4xl font-black tracking-tighter uppercase flex items-center gap-3">
                <Zap className="w-10 h-10 text-violet-500 fill-current" />
                LDO<span className="text-slate-600">lab</span>
            </h1>
            <p className={`${COLORS.textMuted} font-mono mt-1`}>Low Dropout Regulator Interactive Simulation</p>
        </div>
        
        <div className="flex gap-2">
            <button onClick={() => applyPreset('nominal')} className={`${BUTTON_STYLE} bg-slate-800 text-white hover:bg-slate-700`}>
                <CheckCircle size={16}/> Nominal
            </button>
            <button onClick={() => applyPreset('unstable')} className={`${BUTTON_STYLE} bg-slate-800 text-white hover:bg-slate-700`}>
                <AlertCircle size={16}/> Edge Case
            </button>
            <button onClick={() => applyPreset('heavy')} className={`${BUTTON_STYLE} bg-slate-800 text-white hover:bg-slate-700`}>
                <Smartphone size={16}/> Heavy Load
            </button>
        </div>
      </header>

      {/* MAIN GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT COLUMN: CONTROLS (Input) */}
        <div className="lg:col-span-4 space-y-6">
            
            {/* POWER & LOAD CARD */}
            <div className={CARD_STYLE}>
                <div className="flex items-center gap-2 mb-4 border-b border-slate-700 pb-2">
                    <Activity size={18} className="text-orange-500" />
                    <h3 className="font-bold uppercase tracking-wider">Conditions</h3>
                </div>
                <RangeControl label="Input Voltage (Vin)" value={params.vin} min={2.0} max={5.5} step={0.1} unit="V" color="blue" onChange={v => setParams(p => ({...p, vin: v}))} />
                <RangeControl label="Target Vout" value={params.voutTarget} min={0.8} max={3.3} step={0.1} unit="V" color="blue" onChange={v => setParams(p => ({...p, voutTarget: v}))} />
                <RangeControl label="Load Current" value={params.loadCurrent} min={0} max={500} step={10} unit="mA" color="orange" onChange={v => setParams(p => ({...p, loadCurrent: v}))} />
                <RangeControl label="Temperature" value={params.temp} min={-40} max={125} step={5} unit="°C" color="orange" onChange={v => setParams(p => ({...p, temp: v}))} />
            </div>

            {/* CIRCUIT COMPONENTS CARD */}
            <div className={CARD_STYLE}>
                <div className="flex items-center gap-2 mb-4 border-b border-slate-700 pb-2">
                    <Settings size={18} className="text-violet-500" />
                    <h3 className="font-bold uppercase tracking-wider">Components</h3>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                    <RangeControl label="C_out" value={params.cout} min={1} max={50} step={1} unit="µF" color="violet" onChange={v => setParams(p => ({...p, cout: v}))} />
                    <RangeControl label="ESR" value={params.esr} min={1} max={100} step={1} unit="mΩ" color="violet" onChange={v => setParams(p => ({...p, esr: v}))} />
                </div>
                
                <div className="p-3 bg-[#18181b] rounded border border-slate-700 mt-2 mb-4">
                    <p className="text-xs text-slate-500 mb-2 uppercase font-bold">Compensation Network</p>
                    <div className="grid grid-cols-2 gap-4">
                        <RangeControl label="R_comp" value={params.rcomp} min={1} max={100} step={1} unit="kΩ" color="emerald" onChange={v => setParams(p => ({...p, rcomp: v}))} />
                        <RangeControl label="C_comp" value={params.ccomp} min={10} max={500} step={10} unit="pF" color="emerald" onChange={v => setParams(p => ({...p, ccomp: v}))} />
                    </div>
                </div>
            </div>

            {/* CIRCUIT DIAGRAM */}
            <div className={`${CARD_STYLE} p-0 overflow-hidden`}>
                <div className="p-3 bg-slate-800 border-b border-black">
                     <h3 className="text-xs font-bold uppercase tracking-wider text-white">Live Diagram</h3>
                </div>
                <CircuitViz params={params} isSimulating={isSimulating} />
            </div>
        </div>

        {/* RIGHT COLUMN: SIMULATION RESULTS (Output) */}
        <div className="lg:col-span-8 space-y-6">
            
            {/* KPI STRIP */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {simResults && (
                    <>
                        <KPITag 
                            label="Phase Margin" 
                            value={simResults.kpis.phaseMargin} 
                            unit="°" 
                            status={simResults.kpis.phaseMargin > 45 ? "success" : "danger"} 
                        />
                         <KPITag 
                            label="Bandwidth" 
                            value={simResults.kpis.crossOverFreq} 
                            unit="MHz" 
                        />
                        <KPITag 
                            label="Overshoot" 
                            value={simResults.kpis.overshoot} 
                            unit="mV" 
                            status={simResults.kpis.overshoot < 50 ? "success" : "warning"}
                        />
                         <KPITag 
                            label="PSRR @ 1M" 
                            value={simResults.kpis.psrr1MHz} 
                            unit="dB" 
                        />
                    </>
                )}
            </div>

            {/* MAIN PLOT AREA */}
            <div className={`${CARD_STYLE} min-h-[400px] flex flex-col`}>
                {/* TABS */}
                <div className="flex gap-2 mb-4 border-b border-slate-700 pb-2 overflow-x-auto">
                    {['transient', 'bode', 'psrr'].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-4 py-2 rounded-lg font-bold uppercase text-sm transition-all ${activeTab === tab ? 'bg-violet-600 text-white shadow-[2px_2px_0px_black]' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                        >
                            {tab === 'bode' ? 'Loop / Bode' : tab}
                        </button>
                    ))}
                    <div className="ml-auto flex items-center">
                         {isSimulating && <span className="text-xs text-orange-400 font-mono animate-pulse mr-2">SIMULATING...</span>}
                    </div>
                </div>

                {/* CHART RENDERER */}
                <div className="flex-grow w-full h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        {activeTab === 'transient' && simResults ? (
                            <LineChart data={simResults.transientData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                <XAxis dataKey="time" type="number" unit="µs" stroke="#94a3b8" tick={{fill: '#94a3b8', fontSize: 10}} label={{ value: 'Time (µs)', position: 'insideBottom', offset: -5, fill: '#94a3b8' }} />
                                <YAxis domain={['auto', 'auto']} stroke="#94a3b8" tick={{fill: '#94a3b8', fontSize: 10}} label={{ value: 'Vout (V)', angle: -90, position: 'insideLeft', fill: '#94a3b8' }} />
                                <RechartsTooltip 
                                    contentStyle={{ backgroundColor: '#1E1E26', border: '2px solid black', borderRadius: '8px' }}
                                    itemStyle={{ color: '#fff' }}
                                />
                                <Line type="monotone" dataKey="vout" stroke="#8B5CF6" strokeWidth={3} dot={false} animationDuration={300} />
                                <ReferenceLine y={params.voutTarget} stroke="#F97316" strokeDasharray="4 4" />
                            </LineChart>
                        ) : activeTab === 'bode' && simResults ? (
                            <LineChart data={simResults.bodeData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                <XAxis dataKey="freq" scale="log" domain={['auto', 'auto']} type="number" stroke="#94a3b8" tickFormatter={(v) => v < 1e6 ? `${v/1000}k` : `${v/1e6}M`} tick={{fill: '#94a3b8', fontSize: 10}} />
                                <YAxis yAxisId="mag" stroke="#8B5CF6" label={{ value: 'Mag (dB)', angle: -90, position: 'insideLeft', fill: '#8B5CF6' }} tick={{fill: '#8B5CF6', fontSize: 10}} />
                                <YAxis yAxisId="phase" orientation="right" stroke="#F97316" label={{ value: 'Phase (°)', angle: 90, position: 'insideRight', fill: '#F97316' }} tick={{fill: '#F97316', fontSize: 10}} domain={[0, 180]} />
                                <RechartsTooltip 
                                    contentStyle={{ backgroundColor: '#1E1E26', border: '2px solid black', borderRadius: '8px' }}
                                    labelFormatter={(v) => `${(v/1000).toFixed(1)} kHz`}
                                />
                                <Line yAxisId="mag" type="monotone" dataKey="mag" stroke="#8B5CF6" strokeWidth={3} dot={false} />
                                <Line yAxisId="phase" type="monotone" dataKey="phase" stroke="#F97316" strokeWidth={2} dot={false} strokeDasharray="5 5" />
                                <ReferenceLine yAxisId="mag" y={0} stroke="#cbd5e1" />
                            </LineChart>
                        ) : activeTab === 'psrr' && simResults ? (
                            <LineChart data={simResults.psrrData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                <XAxis dataKey="freq" scale="log" domain={['auto', 'auto']} type="number" stroke="#94a3b8" tickFormatter={(v) => v < 1e6 ? `${v/1000}k` : `${v/1e6}M`} tick={{fill: '#94a3b8', fontSize: 10}} />
                                <YAxis stroke="#10B981" label={{ value: 'PSRR (dB)', angle: -90, position: 'insideLeft', fill: '#10B981' }} tick={{fill: '#10B981', fontSize: 10}} />
                                <RechartsTooltip 
                                    contentStyle={{ backgroundColor: '#1E1E26', border: '2px solid black', borderRadius: '8px' }}
                                />
                                <Line type="monotone" dataKey="psrr" stroke="#10B981" strokeWidth={3} dot={false} />
                            </LineChart>
                        ) : (
                            <div className="flex items-center justify-center h-full text-slate-500 font-mono animate-pulse">
                                Initializing Simulation Core...
                            </div>
                        )}
                    </ResponsiveContainer>
                </div>
            </div>

            {/* EXPLANATION / FEEDBACK */}
            <div className="bg-slate-900/50 p-4 rounded-lg border-l-4 border-violet-500">
                <h4 className="text-violet-400 font-bold mb-1 flex items-center gap-2">
                    <Smartphone size={16} /> Engineering Insight
                </h4>
                <p className="text-sm text-slate-400 leading-relaxed">
                    {simResults?.kpis.phaseMargin < 45 
                        ? "Warning: Phase margin is critically low (<45°). This system will ring or oscillate during load transients. Try increasing C_comp or reducing load current." 
                        : "System is stable. Phase margin indicates good damping. The transient response should settle quickly with minimal ringing."}
                </p>
            </div>

        </div>
      </div>
    </div>
  );
}