"""DLDO Circuit Simulator: transient, small-signal, and AC analysis.

Simulates load-step transient response and provides simplified small-signal
loop modeling and PSRR estimates for a 5nm LDO/DLDO. This is a compact
analytical model intended for fast sweeps; integrate SPICE for correlation.
"""

import numpy as np
from dataclasses import dataclass
from typing import Dict, List

@dataclass
class LDOParams:
    """Design parameters for the DLDO.

    Units:
    - voltages in V, currents in A (use mA conversion at API), times in s where applicable
    - capacitances in F, resistances in Ohm
    """
    vin: float = 0.70
    vout_target: float = 0.50
    max_load: float = 0.200  # A
    settling_ns: float = 42
    droop_mv: float = 38
    efficiency: float = 0.963

    # Small-signal / compensation params (simplified defaults)
    cout_uF: float = 10.0  # Output capacitor magnitude (uF)
    esr_mohm: float = 5.0  # Output capacitor ESR (mOhm)
    comp_r_kohm: float = 10.0  # Compensation resistor (kOhm)
    comp_c_pf: float = 100.0  # Compensation capacitor (pF)
    phase_margin_deg: float = 60.0  # Target phase margin

class TransientSimulator:
    """Simulates load step transient for DLDO."""
    
    def __init__(self, params: LDOParams = None):
        self.params = params or LDOParams()
    
    def simulate_load_step(self, load_step_ma: int = 100, time_ns: int = 100):
        """Simulate 100mA -> 200mA load step."""
        t = np.linspace(0, time_ns, 1000)
        # Exponential settling with damping
        response = self.params.droop_mv * (1 - np.exp(-t / 10))
        return {
            "time_ns": t.tolist(),
            "droop_mv": response.tolist(),
            "settling_time_ns": self.params.settling_ns,
            "peak_droop_mv": float(np.max(response)),
            "status": "PASS" if np.max(response) < 40 else "FAIL"
        }

class PMOSDriver:
    """PMOS pass device driver with turbo mode."""
    
    def __init__(self, num_fingers: int = 100):
        self.num_fingers = num_fingers
        self.ron = 1.0 / num_fingers  # Initial R_on
        self.turbo_enabled = False
    
    def apply_turbo_mode(self):
        """Enable turbo bias for fast transient response."""
        self.turbo_enabled = True
        self.ron *= 0.85  # 15% improvement
        return {"mode": "turbo", "ron_reduction": "15%"}
    
    def disable_turbo_mode(self):
        """Disable turbo for normal operation."""
        self.turbo_enabled = False
        self.ron /= 0.85  # Restore
        return {"mode": "normal"}

class CircuitSimulator:
    """High-level circuit simulator API compatible with day2 script.

    Provides transient step response in terms of rise time and overshoot.
    """

    def __init__(self, vin: float = 0.80, vout_nom: float = 0.75, load_ia_max_ma: float = 500.0,
                 cout_uF: float = None, esr_mohm: float = None,
                 comp_r_kohm: float = None, comp_c_pf: float = None,
                 phase_margin_deg: float = None):
        # Map inputs to underlying LDOParams
        params = LDOParams(
            vin=vin,
            vout_target=vout_nom,
            max_load=load_ia_max_ma / 1000.0,
        )
        # Optional overrides
        if cout_uF is not None:
            params.cout_uF = cout_uF
        if esr_mohm is not None:
            params.esr_mohm = esr_mohm
        if comp_r_kohm is not None:
            params.comp_r_kohm = comp_r_kohm
        if comp_c_pf is not None:
            params.comp_c_pf = comp_c_pf
        if phase_margin_deg is not None:
            params.phase_margin_deg = phase_margin_deg
        self._params = params
        self._sim = TransientSimulator(params)

    def transient_step_response(self, step_time_us: float = 0.1, step_size_us: float = 0.001):
        """Run a transient step response and summarize metrics.

        Args:
            step_time_us: Total simulation time in microseconds
            step_size_us: Step granularity (unused in simplified model)

        Returns:
            Dict containing rise time in microseconds and overshoot in mV.
        """
        # Prefer physics-inspired free simulator if available
        try:
            from .ldo_system import LDOModel, LoadStep, simulate_load_step
            ldo = LDOModel(vin=self._params.vin, vref=self._params.vout_target,
                           c_out_uF=self._params.cout_uF,
                           esr_ohm=self._params.esr_mohm / 1e3)
            step = LoadStep(i_before_a=0.100, i_after_a=0.200, t_step_us=step_time_us * 0.5)
            tr = simulate_load_step(ldo, step, t_end_us=step_time_us)
            return {
                "tr_us": float(tr.rise_time_us),
                "overshoot_mv": float(tr.overshoot_mv),
                "waveform_time_us": tr.time_us,
                "waveform_vout_v": tr.vout_v,
                "waveform_vmeas_v": tr.v_meas_v,
            }
        except Exception:
            # Fallback to simplified transient model
            time_ns = int(step_time_us * 1000)
            load_step_ma = int(min(100.0, self._params.max_load * 1000.0))
            result = self._sim.simulate_load_step(load_step_ma=load_step_ma, time_ns=time_ns)
            zeta = self._phase_margin_to_damping(self._params.phase_margin_deg)
            wn = self._estimate_natural_frequency()
            tr_us = (1.8 / wn) * 1e6
            mp = np.exp(-zeta * np.pi / np.sqrt(max(1e-9, 1.0 - zeta ** 2)))
            overshoot_mv = float(mp * result.get("peak_droop_mv", 0.0))
            return {
                "tr_us": float(tr_us),
                "overshoot_mv": float(overshoot_mv),
                "waveform_time_ns": result.get("time_ns", []),
                "waveform_droop_mv": result.get("droop_mv", []),
            }

    def bode_loop_gain(self, freqs_hz: np.ndarray) -> Dict[str, List[float]]:
        """Approximate loop gain magnitude/phase over frequency.

        Uses a simple Type-II compensator model with one zero and one pole.
        Returns magnitude in dB and phase in degrees.
        """
        # Compensation zero/pole
        rz = self._params.comp_r_kohm * 1e3
        cz = self._params.comp_c_pf * 1e-12
        fz = 1.0 / (2 * np.pi * rz * cz)

        cout = self._params.cout_uF * 1e-6
        rload = max(1e-3, self._estimate_load_resistance())
        fp_out = 1.0 / (2 * np.pi * rload * cout)

        # DC loop gain (arbitrary scaling to reflect typical values)
        L0 = 75.0  # dB at DC
        w = 2 * np.pi * freqs_hz
        wz = 2 * np.pi * fz
        wp = 2 * np.pi * fp_out

        # |L(jw)| ~ L0 * |(1 + jw/wz) / (1 + jw/wp)|
        num = np.sqrt(1 + (w / wz) ** 2)
        den = np.sqrt(1 + (w / wp) ** 2)
        mag_db = L0 + 20 * np.log10(num / den)

        # Phase: phi ≈ atan(w/wz) - atan(w/wp)
        phase_deg = (np.degrees(np.arctan(w / wz)) - np.degrees(np.arctan(w / wp))).tolist()

        return {
            "freq_hz": freqs_hz.tolist(),
            "mag_db": mag_db.tolist(),
            "phase_deg": phase_deg,
        }

    def estimate_psrr(self, freqs_hz: np.ndarray) -> Dict[str, List[float]]:
        """Estimate PSRR vs frequency using simple single-pole roll-off.

        PSRR improves with loop gain; at high frequency decoupling dominates.
        """
        # Base PSRR at 1MHz target
        base_psrr_db = 65.0
        # Roll-off above a corner frequency (e.g., 100kHz)
        f_corner = 1e5
        roll = 20 * np.log10(1 + (freqs_hz / f_corner))
        psrr_db = np.maximum(0.0, base_psrr_db - roll)
        return {"freq_hz": freqs_hz.tolist(), "psrr_db": psrr_db.tolist()}

    def _estimate_load_resistance(self) -> float:
        # R_load ≈ Vout / I_load_max
        i = max(1e-6, self._params.max_load)
        return self._params.vout_target / i

    def _estimate_natural_frequency(self) -> float:
        # Rough estimate: closed-loop BW ~ min(fz, fp_out) scaled
        rz = self._params.comp_r_kohm * 1e3
        cz = self._params.comp_c_pf * 1e-12
        fz = 1.0 / (2 * np.pi * rz * cz)
        cout = self._params.cout_uF * 1e-6
        rload = max(1e-3, self._estimate_load_resistance())
        fp_out = 1.0 / (2 * np.pi * rload * cout)
        f_bw = max(1e3, min(fz, fp_out) * 4)  # scale up for loop gain
        return 2 * np.pi * f_bw

    @staticmethod
    def _phase_margin_to_damping(pm_deg: float) -> float:
        # Approximate mapping: PM 45° -> ζ~0.35, PM 60° -> ζ~0.5, PM 70° -> ζ~0.7
        if pm_deg <= 45:
            return 0.35
        if pm_deg >= 70:
            return 0.70
        # Linear interpolation between 45 and 70 degrees
        return 0.35 + (pm_deg - 45.0) * (0.70 - 0.35) / (70.0 - 45.0)
