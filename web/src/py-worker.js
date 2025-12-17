// Pyodide worker to run LDO simulations in-browser.
// Loads Pyodide, defines a lightweight Python model, and handles messages from the UI.

let pyodide = null;
let pyodideReadyPromise = null;
let pyodideInitialized = false;

console.log('[LDO Worker] Starting...');


const pythonCode = `
import math, random

def run_sim(params):
    vin = float(params.get('vin', 0.8))
    vout = float(params.get('voutTarget', 0.75))
    load_ma = float(params.get('loadCurrent', 100.0))
    cout_uF = float(params.get('cout', 10.0))
    esr_mohm = float(params.get('esr', 10.0))
    rcomp_kohm = float(params.get('rcomp', 20.0))
    ccomp_pf = float(params.get('ccomp', 100.0))
    temp_c = float(params.get('temp', 25.0))

    load_res = vout / max(load_ma / 1000.0, 1e-6)
    output_pole = 1.0 / (2 * math.pi * (cout_uF * 1e-6) * load_res)
    esr_zero = 1.0 / (2 * math.pi * (cout_uF * 1e-6) * (esr_mohm / 1000.0))
    dominant_pole = 1.0 / (2 * math.pi * (rcomp_kohm * 1e3) * (ccomp_pf * 1e-12))

    dc_gain_db = 80.0 - (load_ma / 500.0) * 20.0

    bode = []
    cross_over = 0.0
    phase_margin = 0.0
    for i in range(51):
        f = 10 ** (3 + (i / 50) * 5)
        mag = dc_gain_db
        mag -= 20 * math.log10(math.sqrt(1 + (f / dominant_pole) ** 2))
        mag -= 20 * math.log10(math.sqrt(1 + (f / output_pole) ** 2))
        mag += 20 * math.log10(math.sqrt(1 + (f / esr_zero) ** 2))

        phase = 180.0
        phase -= math.degrees(math.atan(f / dominant_pole))
        phase -= math.degrees(math.atan(f / output_pole))
        phase += math.degrees(math.atan(f / esr_zero))

        if mag <= 0 and cross_over == 0.0:
            cross_over = f
            phase_margin = phase

        bode.append({'freq': f, 'mag': mag, 'phase': phase if phase >= 0 else phase + 360})

    transient = []
    damping = phase_margin / 100.0 if phase_margin > 0 else 0.5
    wn = (cross_over * 2 * math.pi) if cross_over > 0 else 2 * math.pi * 1e5
    total_time = 5e-6
    steps = 200
    dt = total_time / steps
    steady = vout
    max_over = 0.0
    max_droop = 0.0
    for i in range(steps):
        t = i * dt
        val = steady
        if t > 1e-6:
            t_step = t - 1e-6
            if damping < 1.0:
                wd = wn * math.sqrt(max(1e-6, 1 - damping ** 2))
                envelope = math.exp(-damping * wn * t_step)
                scale = (load_ma / 500.0) * 0.2
                val = steady - scale * (1 - envelope * (math.cos(wd * t_step) + (damping / math.sqrt(max(1e-6, 1 - damping ** 2))) * math.sin(wd * t_step)))
            else:
                val = steady - ((load_ma / 500.0) * 0.1) * (1 - math.exp(-wn * t_step))
        noise = (random.random() - 0.5) * (temp_c / 125.0) * 0.002
        val += noise
        if t > 1e-6:
            if val > steady:
                max_over = max(max_over, (val - steady) * 1000)
            if val < steady:
                max_droop = max(max_droop, (steady - val) * 1000)
        transient.append({'time': t * 1e6, 'vout': val})

    psrr = []
    psrr_1m = 0.0
    for i in range(21):
        f = 10 ** (3 + (i / 20) * 5)
        ps = dc_gain_db - 20 * math.log10(1 + f / 1000.0)
        if ps < 0:
            ps = 0.0
        psrr.append({'freq': f, 'psrr': ps})
        if psrr_1m == 0.0 and f >= 1e6:
            psrr_1m = ps

    rise_time = 0.35 / (cross_over if cross_over > 0 else 1)
    pass_flag = phase_margin > 45 and max_over < 50 and max_droop < 100

    return {
        'bodeData': bode,
        'transientData': transient,
        'psrrData': psrr,
        'kpis': {
            'phaseMargin': round(phase_margin, 1),
            'crossOverFreq': round(cross_over / 1e6, 3),
            'overshoot': round(max_over, 1),
            'droop': round(max_droop, 1),
            'psrr1MHz': round(psrr_1m, 1),
            'riseTimeUs': round(rise_time * 1e6, 3),
            'pass': bool(pass_flag),
        }
    }
`;

async function initPyodide() {
  if (pyodideReadyPromise) return pyodideReadyPromise;
  
  pyodideReadyPromise = (async () => {
    try {
      console.log('[LDO Worker] Starting Pyodide init...');
      self.postMessage({ type: 'status', message: 'loading-pyodide' });
      
      // Load Pyodide using fetch + eval (most reliable for Web Workers)
      console.log('[LDO Worker] Fetching Pyodide from CDN...');
      const pyodideUrl = 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js';
      const response = await fetch(pyodideUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch Pyodide: ${response.status} ${response.statusText}`);
      }
      
      const scriptText = await response.text();
      console.log(`[LDO Worker] Pyodide fetched (${scriptText.length} bytes), evaluating...`);
      
      // Evaluate the script in worker context to define loadPyodide()
      eval(scriptText);
      console.log('[LDO Worker] eval() complete');
      
      // Verify loadPyodide is available
      if (typeof loadPyodide !== 'function') {
        throw new Error('loadPyodide function not available after eval()');
      }
      
      console.log('[LDO Worker] loadPyodide() function available, initializing...');
      pyodide = await loadPyodide({ 
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/' 
      });
      console.log('[LDO Worker] Pyodide instance created');
      
      // Run Python code to define the simulation function
      console.log('[LDO Worker] Running Python code to define run_sim()...');
      await pyodide.runPythonAsync(pythonCode);
      console.log('[LDO Worker] Python simulation function ready');
      
      pyodideInitialized = true;
      self.postMessage({ type: 'ready' });
      console.log('[LDO Worker] Ready!');
      return pyodide;
    } catch (err) {
      const errorMsg = err?.message || String(err);
      console.error('[LDO Worker] Pyodide init FAILED:', errorMsg);
      console.error('[LDO Worker] Stack:', err?.stack);
      self.postMessage({ type: 'error', error: `Pyodide init failed: ${errorMsg}` });
      throw err;
    }
  })();
  
  return pyodideReadyPromise;
}


self.onmessage = async (event) => {
  const { type, payload } = event.data || {};
  console.log('[LDO Worker] Message received:', type);
  
  if (type === 'simulate') {
    try {
      console.log('[LDO Worker] Waiting for Pyodide...');
      const py = await initPyodide();
      console.log('[LDO Worker] Pyodide ready, executing Python simulation...');
      
      // Call the Python function with the params object
      const paramsJson = JSON.stringify(payload);
      console.log('[LDO Worker] Params:', paramsJson);
      const result = await py.runPythonAsync(
        `import json; json.dumps(run_sim(${paramsJson}))`
      );
      
      console.log('[LDO Worker] Python returned result, parsing...');
      const parsed = JSON.parse(result);
      console.log('[LDO Worker] Parse successful, sending to main thread');
      console.log('[LDO Worker] Result keys:', Object.keys(parsed));
      
      self.postMessage({ type: 'result', result: parsed });
    } catch (err) {
      const errorMsg = err?.message || String(err);
      console.error('[LDO Worker] Simulation FAILED:', errorMsg);
      console.error('[LDO Worker] Stack:', err?.stack);
      self.postMessage({ type: 'error', error: errorMsg });
    }
  }
};

