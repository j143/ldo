"""Layout-dependent effects and parasitics analysis

Analyzes routing parasitics, mismatch, and layout-induced
effects on LDO performance in 5nm technology.
"""

import numpy as np
from typing import Dict, List, Tuple
from dataclasses import dataclass


@dataclass
class LayoutSegment:
    """Represents a layout segment with parasitics"""
    name: str
    length_um: float
    width_um: float
    thickness_um: float
    material: str  # 'metal1', 'metal2', etc.
    # Parasitics per unit length (5nm node)
    r_per_um: float  # Ohm/um
    c_per_um: float  # fF/um


class LayoutAnalyzer:
    """Layout effects and parasitics analysis for 5nm LDO"""
    
    # 5nm metal properties
    METAL_RESISTIVITY = {
        'metal1': 2.1e-8,     # Ohm*m
        'metal2': 2.05e-8,
        'metal3': 2.1e-8,
        'metal4': 2.2e-8,
    }
    
    # Capacitance per unit length (fF/um) including fringing
    CAP_PER_LENGTH = {
        'metal1': {'inter': 0.18, 'fringing': 0.12},
        'metal2': {'inter': 0.15, 'fringing': 0.10},
        'metal3': {'inter': 0.12, 'fringing': 0.08},
    }
    
    def __init__(self):
        """Initialize layout analyzer"""
        self.dielectric_constant = 3.2  # Interlayer dielectric for 5nm
        self.metal_thickness_um = 0.06  # 5nm node metal thickness
        
    def calculate_segment_rc(self, segment: LayoutSegment) -> Tuple[float, float]:
        """
        Calculate total resistance and capacitance for a segment
        
        Args:
            segment: Layout segment
            
        Returns:
            Tuple of (total_resistance_ohms, total_capacitance_ff)
        """
        # Total resistance
        r_ohms = segment.r_per_um * segment.length_um
        
        # Total capacitance (parallel and fringing)
        c_ff = segment.c_per_um * segment.length_um
        
        return r_ohms, c_ff
    
    def estimate_rc_delay(self, r_ohms: float, c_ff: float) -> float:
        """
        Estimate RC delay (tau = 0.69 * R * C for typical pulse)
        
        Args:
            r_ohms: Resistance in Ohms
            c_ff: Capacitance in fF
            
        Returns:
            Delay in picoseconds
        """
        c_f = c_ff * 1e-15  # Convert fF to F
        tau_s = 0.69 * r_ohms * c_f  # seconds
        tau_ps = tau_s * 1e12  # picoseconds
        return tau_ps
    
    def mismatch_analysis(self, num_transistors: int,
                         vth_mismatch_mv: float = 0.5) -> Dict[str, float]:
        """
        Analyze mismatch effects for matched transistor arrays
        
        Args:
            num_transistors: Number of matched transistors
            vth_mismatch_mv: Vth mismatch sigma in mV
            
        Returns:
            Mismatch statistics
        """
        # 3-sigma variation in array
        max_vth_delta = 3.0 * vth_mismatch_mv / np.sqrt(num_transistors)
        
        # Current matching impact (gm is proportional to Vgs)
        current_mismatch_pct = (max_vth_delta / 100.0) * 100  # ~0.5% typical
        
        # Offset voltage due to mismatch
        offset_voltage_mv = max_vth_delta * 0.8  # Reduced by feedback
        
        return {
            'max_vth_variation_mv': max_vth_delta,
            'current_mismatch_pct': current_mismatch_pct,
            'offset_voltage_mv': offset_voltage_mv,
            'improvement_with_array': np.sqrt(num_transistors)
        }
    
    def routing_analysis(self, segments: List[LayoutSegment]) -> Dict:
        """
        Comprehensive routing parasitics analysis
        
        Args:
            segments: List of routed segments
            
        Returns:
            Analysis results including total RC and delays
        """
        total_r = 0.0
        total_c = 0.0
        segment_results = []
        
        for segment in segments:
            r, c = self.calculate_segment_rc(segment)
            total_r += r
            total_c += c
            
            delay = self.estimate_rc_delay(r, c)
            segment_results.append({
                'name': segment.name,
                'resistance_ohms': r,
                'capacitance_ff': c,
                'delay_ps': delay
            })
        
        # Total delay (assuming series connection)
        total_delay = self.estimate_rc_delay(total_r, total_c)
        
        return {
            'total_resistance_ohms': total_r,
            'total_capacitance_ff': total_c,
            'total_delay_ps': total_delay,
            'segment_count': len(segments),
            'segments': segment_results
        }
    
    def cross_coupling_analysis(self, victim_segment: LayoutSegment,
                               aggressor_segments: List[LayoutSegment]) -> Dict:
        """
        Analyze capacitive coupling effects between signals
        
        Args:
            victim_segment: Victim signal trace
            aggressor_segments: Adjacent aggressor traces
            
        Returns:
            Coupling analysis
        """
        # Coupling capacitance factor (depends on spacing)
        coupling_factor = 0.3  # 30% of victim's capacitance
        
        victim_r, victim_c = self.calculate_segment_rc(victim_segment)
        
        # Aggressor-induced noise
        total_coupling_c = 0.0
        for aggressor in aggressor_segments:
            _, agg_c = self.calculate_segment_rc(aggressor)
            total_coupling_c += agg_c * coupling_factor
        
        # Noise estimate (dV/dt effect)
        dv_dt_v_per_ns = 0.5  # Typical aggressor slew
        noise_mv = (total_coupling_c * 1e-15) * dv_dt_v_per_ns * 1e-9 * 1e3  # mV
        
        return {
            'victim_self_cap_ff': victim_c,
            'total_coupling_cap_ff': total_coupling_c,
            'estimated_noise_mv': noise_mv,
            'noise_margin_pct': (noise_mv / 50.0) * 100  # Assuming 50mV margin
        }
