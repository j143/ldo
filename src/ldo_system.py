"""Lightweight LDO simulation core using free Python stack.

Implements a simple control-based transient model with PI compensation,
output capacitor + ESR, and load steps. Avoids external paid simulators.
"""

from dataclasses import dataclass
from typing import Dict, List, Tuple
import numpy as np
from scipy.integrate import solve_ivp


@dataclass
class LDOModel:
    """Parameters for the LDO system model."""
    vin: float = 0.80
    vref: float = 0.75
    c_out_uF: float = 10.0
    esr_ohm: float = 0.005
    gm_pass_a_per_v: float = 1.0  # Effective transconductance of pass device
    i_pass_max_a: float = 0.6  # Max current capability (A)
    kp: float = 8.0  # Proportional gain (V/V)
    ki: float = 2.0  # Integral gain (V/(V*us)) in microsecond domain


@dataclass
class LoadStep:
    """Load profile: step current at a given time."""
    i_before_a: float  # Initial load current
    i_after_a: float   # Load current after the step
    t_step_us: float   # Time of step (microseconds)


@dataclass
class TransientResult:
    time_us: List[float]
    vout_v: List[float]
    v_meas_v: List[float]
    ipass_a: List[float]
    rise_time_us: float
    overshoot_mv: float


def _simulate_segment(ldo: LDOModel, i_load_a: float, t0_us: float, t1_us: float, x0: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Simulate a time segment with fixed load current.

    Returns time array (us), state matrix, and derived signals.
    State vector x = [Vout, Iint], where Iint is integral of error.
    Feedback uses measured V = Vout + ESR * (Ip - Iload) to introduce ESR zero.
    """
    c_f = ldo.c_out_uF * 1e-6  # Convert uF to F

    def rhs(t, x):
        vout = x[0]
        iint = x[1]

        v_meas = vout  # Will add ESR contribution via current later

        # Controller U = Kp*e + Ki*∫e, with Ki interpreted per microsecond
        error = ldo.vref - v_meas
        u_ctrl = ldo.kp * error + ldo.ki * iint
        ipass = np.clip(ldo.gm_pass_a_per_v * u_ctrl, 0.0, ldo.i_pass_max_a)

        # ESR contribution to measured voltage: V_meas = Vout + ESR * Icap ≈ Vout + ESR*(Ip - Iload)
        v_meas = vout + ldo.esr_ohm * (ipass - i_load_a)

        dvout_dt = (ipass - i_load_a) / c_f
        diint_dt = error  # Integral of error; units: V * us
        return np.array([dvout_dt, diint_dt])

    t_eval = np.linspace(t0_us, t1_us, max(2, int((t1_us - t0_us) * 100)))  # 0.01us step
    sol = solve_ivp(rhs, (t0_us, t1_us), x0, t_eval=t_eval, method="RK45")
    x = sol.y.T
    vout = x[:, 0]
    iint = x[:, 1]

    # Recompute ipass and measured voltage for logging
    v_meas = np.empty_like(vout)
    ipass = np.empty_like(vout)
    for idx, (t, vs) in enumerate(zip(sol.t, x)):
        v = vs[0]
        ii = vs[1]
        error = ldo.vref - v  # use v (without ESR) for controller state
        u_ctrl = ldo.kp * error + ldo.ki * ii
        ip = np.clip(ldo.gm_pass_a_per_v * u_ctrl, 0.0, ldo.i_pass_max_a)
        ipass[idx] = ip
        v_meas[idx] = v + ldo.esr_ohm * (ip - i_load_a)

    return sol.t, x, np.stack([vout, v_meas, ipass], axis=1)


def simulate_load_step(ldo: LDOModel, step: LoadStep, t_end_us: float = 0.2) -> TransientResult:
    """Simulate a load step transient and compute key metrics."""
    # Initial state: Vout close to vref, integral term 0
    x0 = np.array([ldo.vref, 0.0])

    # Segment 1: before step
    t1 = step.t_step_us
    t_seg1, x_seg1, y_seg1 = _simulate_segment(ldo, step.i_before_a, 0.0, t1, x0)

    # Segment 2: after step
    x_mid = x_seg1[-1]
    t_seg2, x_seg2, y_seg2 = _simulate_segment(ldo, step.i_after_a, t1, t_end_us, x_mid)

    # Concatenate
    t = np.concatenate([t_seg1, t_seg2])
    y = np.concatenate([y_seg1, y_seg2])
    vout = y[:, 0]
    v_meas = y[:, 1]
    ipass = y[:, 2]

    # Compute rise time (10%-90%) after step for measured voltage
    post_idx = np.searchsorted(t, step.t_step_us)
    v_final = np.mean(v_meas[-int(0.05 * len(v_meas)) or 1 :])
    v_step_region = v_meas[post_idx:]
    t_step_region = t[post_idx:]
    v_low = ldo.vref * 0.1 + v_final * 0.9 if v_final > ldo.vref else v_final * 0.1 + ldo.vref * 0.9
    v_high = ldo.vref * 0.9 + v_final * 0.1 if v_final > ldo.vref else v_final * 0.9 + ldo.vref * 0.1

    try:
        t10 = t_step_region[np.where(v_step_region >= v_low)[0][0]]
        t90 = t_step_region[np.where(v_step_region >= v_high)[0][0]]
        rise_time_us = float(max(0.0, t90 - t10))
    except IndexError:
        rise_time_us = 0.0

    # Overshoot: max deviation above final value after step
    overshoot = float(np.max(v_step_region) - v_final)
    overshoot_mv = overshoot * 1e3

    return TransientResult(
        time_us=t.tolist(),
        vout_v=vout.tolist(),
        v_meas_v=v_meas.tolist(),
        ipass_a=ipass.tolist(),
        rise_time_us=rise_time_us,
        overshoot_mv=overshoot_mv,
    )
