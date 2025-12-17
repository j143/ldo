import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';
import { Play, RotateCcw, Zap, Activity, Waves, Thermometer, Settings, Download, AlertCircle, CheckCircle, Smartphone } from 'lucide-react';
import '../styles.css';

// --- SIMULATION ENGINE (Approximated) ---

const simulateLDO = (params) => {
  const { vin, voutTarget, loadCurrent, cout, esr, rcomp, ccomp, temp } = params;
  
  const loadRes = voutTarget / (Math.max(loadCurrent, 1) / 1000);
  const outputPole = 1 / (2 * Math.PI * (cout * 1e-6) * loadRes);
  const esrZero = 1 / (2 * Math.PI * (cout * 1e-6) * (esr / 1000));
  const dominantPole = 1 / (2 * Math.PI * (rcomp * 1000) * (ccomp * 1e-12));
  
  const dcGainDb = 80 - (loadCurrent / 500) * 20; 

  const bodeData = [];
  let crossOverFreq = 0;
  let phaseMargin = 0;
  
  for (let i = 0; i <= 50; i++) {
    const f = Math.pow(10, 3 + (i / 50) * 5);
    
    let mag = dcGainDb;
    mag -= 20 * Math.log10(Math.sqrt(1 + Math.pow(f / dominantPole, 2)));
    mag -= 20 * Math.log10(Math.sqrt(1 + Math.pow(f / outputPole, 2)));
    mag += 20 * Math.log10(Math.sqrt(1 + Math.pow(f / esrZero, 2)));

    let phase = 180;
    phase -= (Math.atan(f / dominantPole) * 180) / Math.PI;
    phase -= (Math.atan(f / outputPole) * 180) / Math.PI;
    phase += (Math.atan(f / esrZero) * 180) / Math.PI;

    if (mag <= 0 && crossOverFreq === 0) {
      crossOverFreq = f;
      phaseMargin = phase;
    }

    bodeData.push({ freq: f, mag, phase: phase < 0 ? phase + 360 : phase });
  }

  const transientData = [];
  const dampingRatio = phaseMargin / 100;
  const naturalFreq = crossOverFreq * 2 * Math.PI; 
  const dt = 5e-6 / 100;

  let maxOvershoot = 0;
  let maxDroop = 0;
  const steadyState = voutTarget;
  
  for (let i = 0; i < 100; i++) {
    const t = i * dt;
    let val = steadyState;

    if (t > 1e-6) {
      const t_step = t - 1e-6;
      if (dampingRatio < 1) {
        const wd = naturalFreq * Math.sqrt(1 - dampingRatio * dampingRatio);
        const envelope = Math.exp(-dampingRatio * naturalFreq * t_step);
        const scale = (loadCurrent / 500) * 0.2;
        val = steadyState - scale * (1 - envelope * (Math.cos(wd * t_step) + (dampingRatio/Math.sqrt(1-dampingRatio**2)) * Math.sin(wd * t_step)));
      } else {
        val = steadyState - ((loadCurrent/500)*0.1) * (1 - Math.exp(-naturalFreq * t_step));
      }
    }
    
    const noise = (Math.random() - 0.5) * (temp / 125) * 0.002;
    val += noise;

    if (t > 1e-6) {
        if (val > steadyState) maxOvershoot = Math.max(maxOvershoot, (val - steadyState) * 1000);
        if (val < steadyState) maxDroop = Math.max(maxDroop, (steadyState - val) * 1000);
    }
    
    transientData.push({ time: t * 1e6, vout: val });
  }

  const psrrData = [];
  for (let i = 0; i <= 20; i++) {
    const f = Math.pow(10, 3 + (i / 20) * 5);
    let psrr = dcGainDb - 20 * Math.log10(1 + f/1000); 
    if (psrr < 0) psrr = 0;
    psrrData.push({ freq: f, psrr });
  }

  const psrr1MHz = psrrData.find(d => d.freq >= 1e6)?.psrr || 0;

  const riseTime = 0.35 / (crossOverFreq || 1); 
  const pass = phaseMargin > 45 && maxOvershoot < 50 && maxDroop < 100;

  return {
    bodeData,
    transientData,
    psrrData,
    kpis: {
      phaseMargin: phaseMargin.toFixed(1),
      crossOverFreq: (crossOverFreq / 1e6).toFixed(2),
      overshoot: maxOvershoot.toFixed(1),
      droop: maxDroop.toFixed(1),
      psrr1MHz: psrr1MHz.toFixed(1),
      pass
    }
  };
};

// --- SUB-COMPONENTS ---

const RangeControl = ({ label, value, min, max, step, unit, onChange }) => {
  return (
    <div className="input-group">
      <div className="input-group-header">
        <label className="label">{label}</label>
        <span className="input-value">
          {value} <span className="input-unit">{unit}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
};

const KPITag = ({ label, value, unit, status = "neutral" }) => {
  return (
    <div className={`kpi-tag ${status}`}>
      <div className="kpi-tag-label">{label}</div>
      <div className="kpi-tag-value">
        {value}<span className="kpi-tag-unit">{unit}</span>
      </div>
    </div>
  );
};

// SVG Circuit Visualization
const CircuitViz = ({ params, isSimulating }) => {
    const compColor = params.rcomp > 30 ? "#EF4444" : "#8B5CF6";
    const capSize = 20 + (params.cout / 50) * 20;

    return (
      <div className="circuit-viz">
        <svg viewBox="0 0 400 200" style={{ width: '100%', height: '100%' }}>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#2A2A35" strokeWidth="1"/>
            </pattern>
            <rect width="400" height="200" fill="url(#grid)" />

            <g transform="translate(40, 100)">
                <circle cx="0" cy="0" r="15" fill="#3B82F6" opacity="0.2" />
                <text x="0" y="5" textAnchor="middle" fill="#3B82F6" fontSize="10" fontWeight="bold">VIN</text>
                <text x="0" y="25" textAnchor="middle" fill="#64748b" fontSize="8">{params.vin}V</text>
            </g>

            <g transform="translate(140, 100)">
                <rect x="-20" y="-30" width="40" height="60" rx="8" fill="#2A2A35" stroke="#8B5CF6" strokeWidth="2" />
                <path d="M -20 0 L -80 0" stroke="#475569" strokeWidth="3" />
                <path d="M 20 0 L 120 0" stroke="#475569" strokeWidth="3" />
                
                <path d="M 0 -30 L 0 -60" stroke="#475569" strokeWidth="2" strokeDasharray="4 2" />
                <circle cx="0" cy="-60" r="4" fill={isSimulating ? "#F97316" : "#475569"}>
                    {isSimulating && <animate attributeName="opacity" values="1;0.5;1" dur="0.5s" repeatCount="indefinite" />}
                </circle>
            </g>

            <g transform="translate(140, 40)">
                 <path d="M 0 0 L 0 30" stroke="#475569" strokeWidth="2" />
                 <rect x="-25" y="-20" width="50" height="30" rx="4" fill="#2A2A35" stroke={compColor} strokeWidth="2" />
                 <text x="0" y="0" textAnchor="middle" fill="white" fontSize="8">Error Amp</text>
            </g>

            <g transform="translate(260, 100)">
                <line x1="0" y1="0" x2="0" y2="40" stroke="#475569" strokeWidth="3" />
                <rect x="-10" y="40" width="20" height={capSize} rx="4" fill="#3B82F6" opacity="0.3" stroke="#3B82F6" />
                <text x="30" y="60" fill="#94a3b8" fontSize="10">Cout: {params.cout}µF</text>
                <text x="30" y="75" fill="#94a3b8" fontSize="10">ESR: {params.esr}mΩ</text>
            </g>

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
  const [params, setParams] = useState({
    vin: 3.3,
    voutTarget: 1.8,
    loadCurrent: 100,
    cout: 10,
    esr: 10,
    rcomp: 20,
    ccomp: 100,
    temp: 25,
  });

  const [simResults, setSimResults] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [activeTab, setActiveTab] = useState('transient');
  const [pyReady, setPyReady] = useState(false);
  const [simError, setSimError] = useState(null);

  const workerRef = useRef(null);

  useEffect(() => {
    let worker;
    try {
      worker = new Worker(new URL('./py-worker.js', import.meta.url), { type: 'module' });
    } catch (e) {
      worker = new Worker('py-worker.js');
    }
    workerRef.current = worker;
    worker.onmessage = (evt) => {
      const { type, result, error } = evt.data || {};
      if (type === 'ready') {
        setPyReady(true);
      } else if (type === 'result') {
        setSimResults(result);
        setIsSimulating(false);
        setSimError(null);
      } else if (type === 'error') {
        setSimError(error || 'Simulation error');
        setIsSimulating(false);
      }
    };
    worker.onerror = (err) => {
      setSimError(err.message || 'Worker error');
      setIsSimulating(false);
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const runSimulation = useCallback(() => {
    if (!workerRef.current || !pyReady) {
      const results = simulateLDO(params);
      setSimResults(results);
      return;
    }
    setIsSimulating(true);
    setSimError(null);
    workerRef.current.postMessage({ type: 'simulate', payload: params });
  }, [params, pyReady]);

  useEffect(() => {
    const timer = setTimeout(runSimulation, 250);
    return () => clearTimeout(timer);
  }, [runSimulation]);

  const applyPreset = (type) => {
    const presets = {
      nominal: { cout: 10, esr: 10, loadCurrent: 100, rcomp: 20 },
      unstable: { cout: 1, esr: 1, loadCurrent: 10, rcomp: 50 },
      heavy: { cout: 47, esr: 20, loadCurrent: 500, rcomp: 10 },
    };
    if (presets[type]) setParams(p => ({ ...p, ...presets[type] }));
  };

  return (
    <div className="container">
      {/* HEADER */}
      <header className="header">
        <div>
            <h1 className="header-title">
                <Zap className="header-title-icon" />
                LDO<span style={{ color: '#64748b' }}>lab</span>
            </h1>
            <p className="header-subtitle">Low Dropout Regulator Interactive Simulation</p>
        </div>
        
        <div className="header-buttons">
            <button onClick={() => applyPreset('nominal')} className="button">
                <CheckCircle size={16}/> Nominal
            </button>
            <button onClick={() => applyPreset('unstable')} className="button">
                <AlertCircle size={16}/> Edge Case
            </button>
            <button onClick={() => applyPreset('heavy')} className="button">
                <Smartphone size={16}/> Heavy Load
            </button>
        </div>
      </header>

      {/* MAIN GRID */}
      <div className="main-grid">
        
        {/* LEFT COLUMN: CONTROLS */}
        <div className="main-grid-left">
            
            {/* POWER & LOAD CARD */}
            <div className="card">
                <div className="card-header">
                    <Activity size={18} style={{ color: '#F97316' }} />
                    <h3>Conditions</h3>
                </div>
                <RangeControl label="Input Voltage (Vin)" value={params.vin} min={2.0} max={5.5} step={0.1} unit="V" onChange={v => setParams(p => ({...p, vin: v}))} />
                <RangeControl label="Target Vout" value={params.voutTarget} min={0.8} max={3.3} step={0.1} unit="V" onChange={v => setParams(p => ({...p, voutTarget: v}))} />
                <RangeControl label="Load Current" value={params.loadCurrent} min={0} max={500} step={10} unit="mA" onChange={v => setParams(p => ({...p, loadCurrent: v}))} />
                <RangeControl label="Temperature" value={params.temp} min={-40} max={125} step={5} unit="°C" onChange={v => setParams(p => ({...p, temp: v}))} />
            </div>

            {/* CIRCUIT COMPONENTS CARD */}
            <div className="card">
                <div className="card-header">
                    <Settings size={18} style={{ color: '#8B5CF6' }} />
                    <h3>Components</h3>
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <RangeControl label="C_out" value={params.cout} min={1} max={50} step={1} unit="µF" onChange={v => setParams(p => ({...p, cout: v}))} />
                    <RangeControl label="ESR" value={params.esr} min={1} max={100} step={1} unit="mΩ" onChange={v => setParams(p => ({...p, esr: v}))} />
                </div>
                
                <div style={{ padding: '0.75rem', backgroundColor: '#18181b', borderRadius: '8px', border: `1px solid ${getComputedStyle(document.documentElement).getPropertyValue('--color-border')}`, marginTop: '0.5rem', marginBottom: '1rem' }}>
                    <p style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Compensation Network</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <RangeControl label="R_comp" value={params.rcomp} min={1} max={100} step={1} unit="kΩ" onChange={v => setParams(p => ({...p, rcomp: v}))} />
                        <RangeControl label="C_comp" value={params.ccomp} min={10} max={500} step={10} unit="pF" onChange={v => setParams(p => ({...p, ccomp: v}))} />
                    </div>
                </div>
            </div>

            {/* CIRCUIT DIAGRAM */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '0.75rem', backgroundColor: '#374151', borderBottom: '2px solid black' }}>
                     <h3 className="label">Live Diagram</h3>
                </div>
                <CircuitViz params={params} isSimulating={isSimulating} />
            </div>
        </div>

        {/* RIGHT COLUMN: RESULTS */}
        <div className="main-grid-right">
            
            {/* KPI STRIP */}
            <div className="kpi-grid">
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
            <div className="card" style={{ minHeight: '400px', display: 'flex', flexDirection: 'column' }}>
                {/* TABS */}
                <div className="tabs">
                    {['transient', 'bode', 'psrr'].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`tab-button ${activeTab === tab ? 'active' : ''}`}
                        >
                            {tab === 'bode' ? 'Loop / Bode' : tab}
                        </button>
                    ))}
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {!pyReady && <span style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: 'monospace' }}>Loading Pyodide…</span>}
                        {isSimulating && <span style={{ fontSize: '0.75rem', color: '#F97316', fontFamily: 'monospace', animation: 'pulse 1s infinite' }}>SIMULATING...</span>}
                    </div>
                </div>

                {/* CHART RENDERER */}
                <div className="chart-container">
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
                            <div className="chart-placeholder">
                                Initializing Simulation Core...
                            </div>
                        )}
                    </ResponsiveContainer>
                </div>
            </div>

            {simError && (
              <div className="error-message">
                Simulation error: {simError}
              </div>
            )}

            {/* INSIGHT BOX */}
            <div className="insight-box">
                <h4>
                    <Smartphone size={16} /> Engineering Insight
                </h4>
                <p>
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
