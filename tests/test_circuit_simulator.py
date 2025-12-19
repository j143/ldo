"""
Integration tests for LDO simulation functions in circuit_simulator.py
References in comments per engineering-validation.md
"""

import sys
import os
import numpy as np
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../src')))
from circuit_simulator import CircuitSimulator

def test_phase_margin_to_overshoot_circuit_sim():
    """
    Validate phase margin to overshoot mapping using CircuitSimulator.
    Ref: [2], [3]
    """
    # PM ≈ 60° (ζ ≈ 0.6) → small overshoot (~10-15%)
    sim = CircuitSimulator(phase_margin_deg=60)
    result = sim.transient_step_response()
    # With improved formula, expect realistic overshoot
    assert 5 < result["overshoot_mv"] < 25
    # PM ≈ 45° (ζ ≈ 0.45) → larger overshoot (~20-30%)
    sim = CircuitSimulator(phase_margin_deg=45)
    result = sim.transient_step_response()
    assert 15 < result["overshoot_mv"] < 50

def test_bode_pole_zero_circuit_sim():
    """
    Validate dominant pole and ESR zero in Bode plot.
    Ref: [3]
    """
    sim = CircuitSimulator(cout_uF=10, esr_mohm=100)
    freqs = np.logspace(2, 6, 100)
    bode = sim.bode_loop_gain(freqs)
    
    # Check that magnitude drops near expected pole
    fp_out = 1/(2*np.pi*10*1e-6*0.75/0.5)  # Rload ~ Vout/Imax
    idx_pole = np.argmin(np.abs(freqs - fp_out))
    assert bode["mag_db"][idx_pole] < bode["mag_db"][0]
    
    # Check that poles_zeros are returned for frontend
    assert "poles_zeros" in bode
    pz = bode["poles_zeros"]
    assert "fp_out" in pz
    assert "fz_esr" in pz
    assert "fz_comp" in pz
    # Verify ESR zero frequency is computed correctly
    fz_expected = 1/(2*np.pi*0.1*10e-6)
    assert abs(pz["fz_esr"] - fz_expected) < 1000

def test_psrr_circuit_sim():
    """
    Validate PSRR shape and low-frequency plateau.
    Ref: [3]
    """
    sim = CircuitSimulator()
    freqs = np.logspace(2, 7, 100)
    psrr = sim.estimate_psrr(freqs)
    # PSRR should be high at low freq, drop at high freq
    assert psrr["psrr_db"][0] > 50
    assert psrr["psrr_db"][-1] < 20

def test_transient_undershoot_circuit_sim():
    """
    Validate transient undershoot for load step.
    Ref: [6]
    """
    sim = CircuitSimulator(cout_uF=10)
    result = sim.transient_step_response()
    # Should be in expected range for 100mA step, 10uF
    assert 5 < result["overshoot_mv"] < 50
