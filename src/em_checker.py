"""Electromigration (EM) and current density checker

Verifies design compliance with EM and current density limits
for metal interconnects and vias in 5nm node.
"""

import numpy as np
from typing import Dict, List, Tuple
from dataclasses import dataclass


@dataclass
class MetalSegment:
    """Represents a metal segment for EM analysis"""
    name: str
    width_um: float
    length_um: float
    thickness_um: float
    material: str  # 'copper', 'tungsten', etc.
    current_ma: float
    temperature_c: float


class EMChecker:
    """Electromigration and current density verification"""
    
    # EM lifetime model parameters (Black's equation: MTTF = A * J^-n * exp(Ea/kT))
    # For 5nm copper interconnects
    EMPIRICAL_A = 1e8  # Hours, empirical constant
    EM_EXPONENT = 2.0  # Current density exponent
    ACTIVATION_ENERGY_EV = 0.55  # eV
    BOLTZMANN_EV_K = 8.617e-5  # eV/K
    
    # 5nm node EM limits
    J_MAX_MA_UM2 = 2.5  # Maximum current density (mA/um^2) for 10yr life
    VIA_J_MAX = 3.5  # Via maximum J for vias
    
    def __init__(self):
        """Initialize EM checker with 5nm technology node specs"""
        self.metal_resistivity = 2.0e-8  # Ohm*m for copper at 25C
        self.temp_coeff_r = 0.0039  # 1/K resistivity temp coefficient
        
    def calculate_current_density(self, segment: MetalSegment) -> float:
        """
        Calculate current density for a metal segment
        
        Args:
            segment: Metal segment with geometry and current
            
        Returns:
            Current density in mA/um^2
        """
        cross_section_um2 = segment.width_um * segment.thickness_um
        if cross_section_um2 <= 0:
            return 0.0
        
        current_density = segment.current_ma / cross_section_um2
        return current_density
    
    def calculate_mttf(self, j_ma_um2: float, temp_c: float = 125.0) -> float:
        """
        Calculate MTTF using Black's equation
        
        Args:
            j_ma_um2: Current density in mA/um^2
            temp_c: Temperature in Celsius
            
        Returns:
            MTTF in hours
        """
        if j_ma_um2 <= 0:
            return np.inf
        
        # Convert temperature to Kelvin
        temp_k = temp_c + 273.15
        
        # Black's equation: MTTF = A * J^-n * exp(Ea/kT)
        j_exponent = np.power(j_ma_um2, -self.EM_EXPONENT)
        temp_factor = np.exp(self.ACTIVATION_ENERGY_EV / (self.BOLTZMANN_EV_K * temp_k))
        mttf_hours = self.EMPIRICAL_A * j_exponent * temp_factor
        
        return mttf_hours
    
    def check_em_compliance(self, segment: MetalSegment, 
                           required_life_years: float = 10.0) -> Dict[str, float]:
        """
        Check EM compliance for a metal segment
        
        Args:
            segment: Metal segment to check
            required_life_years: Required lifetime in years
            
        Returns:
            Compliance check results
        """
        j = self.calculate_current_density(segment)
        mttf_hours = self.calculate_mttf(j, segment.temperature_c)
        required_hours = required_life_years * 8760  # 24 * 365
        
        # Worst-case acceleration factor
        accel_factor = 2.0 if segment.temperature_c > 100 else 1.0
        effective_mttf = mttf_hours / accel_factor
        
        pass_fail = effective_mttf > required_hours
        margin = effective_mttf / required_hours if required_hours > 0 else 0
        
        return {
            'current_density_ma_um2': j,
            'mttf_hours': mttf_hours,
            'effective_mttf_hours': effective_mttf,
            'required_hours': required_hours,
            'margin': margin,
            'pass': pass_fail,
            'exceeds_limit': j > self.J_MAX_MA_UM2
        }
    
    def optimize_segment_width(self, segment: MetalSegment,
                              target_j_ma_um2: float = None) -> float:
        """
        Calculate optimal metal width to meet current density limit
        
        Args:
            segment: Metal segment
            target_j_ma_um2: Target current density (or use J_MAX)
            
        Returns:
            Required width in um
        """
        if target_j_ma_um2 is None:
            target_j_ma_um2 = self.J_MAX_MA_UM2
        
        required_area = segment.current_ma / target_j_ma_um2
        required_width = required_area / segment.thickness_um
        
        return required_width
    
    def batch_check(self, segments: List[MetalSegment]) -> Dict:
        """
        Check EM compliance for multiple segments
        
        Args:
            segments: List of metal segments
            
        Returns:
            Batch analysis results
        """
        results = []
        max_density = 0.0
        min_margin = np.inf
        fail_count = 0
        
        for segment in segments:
            check = self.check_em_compliance(segment)
            results.append(check)
            
            max_density = max(max_density, check['current_density_ma_um2'])
            if not check['pass']:
                fail_count += 1
            min_margin = min(min_margin, check['margin'])
        
        return {
            'total_segments': len(segments),
            'failed_count': fail_count,
            'pass_rate': (len(segments) - fail_count) / len(segments) if segments else 0,
            'max_current_density': max_density,
            'min_margin': min_margin,
            'details': results
        }
