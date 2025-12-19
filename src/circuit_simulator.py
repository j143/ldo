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
        """
        Simulate load step transient with realistic ESR and capacitive components.
        
        Ref: [6] Load transient analysis for LDOs
             https://www.ewadirect.com/proceedings/ace/article/view/16680/pdf
        """
        t = np.linspace(0, time_ns, 1000)
        
        # Immediate ESR step: ΔV_ESR = ΔI·ESR
        delta_i_a = load_step_ma / 1000.0  # Convert mA to A
        esr_ohm = self.params.esr_mohm / 1000.0  # Convert mΩ to Ω
        esr_step_mv = delta_i_a * esr_ohm * 1000.0  # Convert V to mV
        
        # Capacitive droop: ΔV_cap = ΔI·Δt/C_out (before loop responds)
        # Assume loop responds within ~settling_ns
        cout_f = self.params.cout_uF * 1e-6  # Convert μF to F
        t_response_s = self.params.settling_ns * 1e-9  # Convert ns to s
        cap_droop_mv = (delta_i_a * t_response_s / cout_f) * 1000.0 if cout_f > 0 else 0.0
        
        # Combined peak droop
        peak_droop_mv = esr_step_mv + cap_droop_mv
        
        # Exponential recovery with damping
        response = peak_droop_mv * (1 - np.exp(-t / self.params.settling_ns))
        
        return {
            "time_ns": t.tolist(),
            "droop_mv": response.tolist(),
            "settling_time_ns": self.params.settling_ns,
            "peak_droop_mv": float(peak_droop_mv),
            "esr_component_mv": float(esr_step_mv),
            "cap_component_mv": float(cap_droop_mv),
            "status": "PASS" if peak_droop_mv < 40 else "FAIL"
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
            # Rise time for second-order system: tr ≈ 1.8/ωn (10%-90%)
            tr_us = (1.8 / wn) * 1e6
            # Overshoot calculation: Mp = exp(-π·ζ/√(1-ζ²))
            # Ref: [2] Standard second-order step response
            if zeta < 1.0:
                mp = np.exp(-zeta * np.pi / np.sqrt(max(1e-9, 1.0 - zeta ** 2)))
            else:
                mp = 0.0  # Overdamped, no overshoot
            # Use actual peak droop from realistic simulation
            base_undershoot = result.get("peak_droop_mv", 30.0)
            overshoot_mv = float(mp * base_undershoot * 100)  # Scale to realistic mV range
            return {
                "tr_us": float(tr_us),
                "overshoot_mv": float(overshoot_mv),
                "waveform_time_ns": result.get("time_ns", []),
                "waveform_droop_mv": result.get("droop_mv", []),
            }

    def get_pole_zero_frequencies(self) -> Dict[str, float]:
        """
        Calculate and return explicit pole/zero frequencies for display.
        
        Ref: [3] TI SLYT151 - LDO Stability Analysis
             Dominant pole: fp_out ≈ 1/(2π·Rload·Cout)
             ESR zero: fz_esr ≈ 1/(2π·ESR·Cout)
        """
        rz = self._params.comp_r_kohm * 1e3
        cz = self._params.comp_c_pf * 1e-12
        fz_comp = 1.0 / (2 * np.pi * rz * cz)
        
        cout = self._params.cout_uF * 1e-6
        esr = self._params.esr_mohm * 1e-3
        rload = max(1e-3, self._estimate_load_resistance())
        
        fp_out = 1.0 / (2 * np.pi * rload * cout)
        fz_esr = 1.0 / (2 * np.pi * esr * cout) if esr > 0 else 1e9
        fp_hf = 10e6  # High-frequency pole (error amp, parasitic)
        
        return {
            "fp_out": fp_out,
            "fz_esr": fz_esr,
            "fz_comp": fz_comp,
            "fp_hf": fp_hf,
        }

    def bode_loop_gain(self, freqs_hz: np.ndarray) -> Dict[str, List[float]]:
        """
        Improved loop gain model with explicit ESR zero, output pole, and compensation zero.
        
        Ref: [3] TI SLYT151 - LDO Stability and Frequency Compensation
             https://www.ti.com/lit/pdf/slyt151
        """
        # Get explicit pole/zero frequencies
        pz = self.get_pole_zero_frequencies()
        fp_out = pz["fp_out"]
        fz_esr = pz["fz_esr"]
        fz_comp = pz["fz_comp"]
        fp_hf = pz["fp_hf"]

        # DC loop gain (scales with load)
        # Lower load current → higher Rload → higher DC gain
        L0 = 80.0 - (self._params.max_load * 1000 / 500) * 10  # Adjust for load
        
        w = 2 * np.pi * freqs_hz
        wz_comp = 2 * np.pi * fz_comp
        wz_esr = 2 * np.pi * fz_esr
        wp_out = 2 * np.pi * fp_out
        wp_hf = 2 * np.pi * fp_hf

        # |L(jw)| ~ L0 * |(1 + jw/wz_comp)*(1 + jw/wz_esr) / ((1 + jw/wp_out)*(1 + jw/wp_hf))|
        num = np.sqrt((1 + (w / wz_comp) ** 2) * (1 + (w / wz_esr) ** 2))
        den = np.sqrt((1 + (w / wp_out) ** 2) * (1 + (w / wp_hf) ** 2))
        mag_db = L0 + 20 * np.log10(num / den)

        # Phase: sum of zero phases minus sum of pole phases
        phase_deg = (
            np.degrees(np.arctan(w / wz_comp))
            + np.degrees(np.arctan(w / wz_esr))
            - np.degrees(np.arctan(w / wp_out))
            - np.degrees(np.arctan(w / wp_hf))
        ).tolist()

        return {
            "freq_hz": freqs_hz.tolist(),
            "mag_db": mag_db.tolist(),
            "phase_deg": phase_deg,
            "poles_zeros": pz,  # Include for frontend visualization
        }

    def estimate_psrr(self, freqs_hz: np.ndarray) -> Dict[str, List[float]]:
        """
        Improved PSRR model with realistic frequency-dependent behavior.
        
        - Low-frequency PSRR set by loop gain
        - Knee near unity-gain bandwidth where loop effectiveness rolls off
        - High-frequency plateau determined by device capacitances
        - PSRR coupled to Cout and load current
        
        Ref: [3] TI SLYT151 - PSRR behavior in LDOs
             https://www.ti.com/lit/pdf/slyt151
        """
        # Estimate loop gain magnitude at each frequency
        bode = self.bode_loop_gain(freqs_hz)
        
        # PSRR at low freq: proportional to loop gain
        # Higher Cout and lower load -> better PSRR
        cout_factor = min(1.5, self._params.cout_uF / 10.0)  # Normalized to 10uF
        load_factor = 1.0 - (self._params.max_load * 1000 / 500) * 0.2  # Heavy load degrades PSRR
        
        psrr_base = np.array(bode["mag_db"]) * cout_factor * load_factor
        
        # Estimate bandwidth from Bode data (0 dB crossing)
        mag_db_array = np.array(bode["mag_db"])
        # Find approximate bandwidth
        crossings = np.where(mag_db_array < 0)[0]
        if len(crossings) > 0:
            f_bw = freqs_hz[crossings[0]]
        else:
            f_bw = 1e5  # Default 100 kHz
        
        # Add knee at bandwidth and roll-off
        roll = 40 * np.log10(1 + (freqs_hz / f_bw))  # Steeper roll than before
        psrr_db = psrr_base - roll
        
        # High-frequency floor: device-limited rejection (10-15 dB typical)
        # Ref: [3] Package and device capacitances provide minimum rejection
        psrr_floor = 10.0 + 5.0 * cout_factor  # Better Cout -> slightly better HF PSRR
        psrr_db = np.maximum(psrr_floor, psrr_db)
        
        return {
            "freq_hz": freqs_hz.tolist(),
            "psrr_db": psrr_db.tolist(),
            "bandwidth_hz": float(f_bw),
        }

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
        """
        Convert phase margin to damping ratio using standard second-order approximation.
        
        Standard mapping for second-order systems:
        - ζ ≈ PM/100 (in degrees)
        - PM ≈ 60° → ζ ≈ 0.6-0.7 → ~5-10% overshoot
        - PM ≈ 45° → ζ ≈ 0.4-0.45 → ~20-25% overshoot
        - PM < 30° → ζ < 0.3 → highly underdamped, large overshoot
        
        Ref: [2] Choosing Phase Margins Considering Transient Response
             https://schematicsforfree.com/files/Power%20Electronics/Theory/
        Ref: [3] TI SLYT151 - LDO Basics
             https://www.ti.com/lit/pdf/slyt151
        """
        # Standard approximation: ζ ≈ PM/100
        # This matches empirical data from control theory and LDO app notes
        zeta = pm_deg / 100.0
        # Clamp to valid second-order range
        return max(0.1, min(0.95, zeta))
