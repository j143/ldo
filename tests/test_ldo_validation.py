"""
Unit tests for LDO simulation calculations.
Each test references relevant literature for validation.

References:
[1] https://www.ijfmr.com/papers/2023/1/32756.pdf
[2] https://schematicsforfree.com/files/Power%20Electronics/Theory/Choosing%20Phase%20Margins%20Considering%20Transient%20Response.pdf
[3] https://www.ti.com/lit/pdf/slyt151
[6] https://www.ewadirect.com/proceedings/ace/article/view/16680/pdf
"""

import sys
import os
import math
import pytest
# Example: Import your simulation functions here
# sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../src')))
# from ldo_system import calculate_phase_margin, calculate_overshoot, ...

# --- Phase Margin ↔ Damping ↔ Overshoot ---
def test_phase_margin_to_overshoot():
    """
    Validate phase margin to overshoot mapping.
    Ref: [2], [3]
    """
    # Example values: ζ ≈ 0.7 ↔ PM ≈ 60°, ζ ≈ 0.4 ↔ PM ≈ 45°
    def overshoot(zeta):
        # Standard second-order overshoot formula
        if zeta <= 0 or zeta >= 1:
            return 0.0
        return math.exp(-math.pi * zeta / math.sqrt(1 - zeta**2))
    # ζ = 0.7 (PM ≈ 60°) → ~5% overshoot
    assert 0.04 < overshoot(0.7) < 0.08
    # ζ = 0.4 (PM ≈ 45°) → ~25% overshoot
    assert 0.20 < overshoot(0.4) < 0.30

# --- Bode Plot: Poles/Zeros ---
def test_dominant_pole():
    """
    Validate dominant pole calculation.
    Ref: [3]
    """
    R_load = 10
    C_out = 10e-6
    f_p_out = 1 / (2 * math.pi * R_load * C_out)
    assert abs(f_p_out - 1.59e3) < 10  # ~1.59 kHz

def test_esr_zero():
    """
    Validate ESR zero calculation.
    Ref: [3]
    """
    ESR = 0.1
    C_out = 10e-6
    f_z_esr = 1 / (2 * math.pi * ESR * C_out)
    assert abs(f_z_esr - 1.59e5) < 1000  # ~159 kHz

# --- PSRR ---
def test_psrr_low_freq():
    """
    Validate low-frequency PSRR is set by loop gain.
    Ref: [3]
    """
    Aol = 1e4  # open-loop gain
    beta = 0.1
    psrr_db = 20 * math.log10(Aol * beta)
    assert 55 < psrr_db < 65  # 20*log10(1000) = 60 dB

# --- Transient Response ---
def test_transient_undershoot():
    """
    Validate first-cycle undershoot for load step.
    Ref: [6]
    """
    delta_I = 0.1  # 100 mA
    delta_t = 1e-6  # 1 us
    C_out = 10e-6
    delta_V = delta_I * delta_t / C_out
    assert abs(delta_V - 0.01) < 0.002  # ~10 mV

def test_esr_step():
    """
    Validate ESR step in transient.
    Ref: [6]
    """
    delta_I = 0.1
    ESR = 0.1
    delta_V_esr = delta_I * ESR
    assert abs(delta_V_esr - 0.01) < 0.002  # ~10 mV
