"""PVT corner analysis for LDO design

Analyzes Process, Voltage, and Temperature corners
to verify design specifications across operational range.
"""

import numpy as np
from typing import Dict, List, Tuple
from dataclasses import dataclass


@dataclass
class PVTCorner:
    """Represents a single PVT corner"""
    name: str
    process: str  # 'tt', 'ss', 'ff', 'fs', 'sf'
    voltage: float  # Supply voltage (V)
    temperature: float  # Temperature (Celsius)
    
    
class PVTAnalysis:
    """PVT corner analysis for 5nm LDO design"""
    
    def __init__(self):
        """Initialize PVT analysis with 5nm specifications"""
        # Voltage range for 5nm node
        self.v_nom = 0.8  # Nominal supply voltage
        self.v_min = 0.75  # Minimum supply
        self.v_max = 0.85  # Maximum supply
        
        # Temperature range
        self.temp_min = -40  # °C
        self.temp_nom = 25   # °C
        self.temp_max = 125  # °C
        
        # Process corners (75 total combinations)
        self.process_corners = ['tt', 'ss', 'ff', 'fs', 'sf']
        
    def generate_corners(self) -> List[PVTCorner]:
        """
        Generate all PVT corners for comprehensive analysis
        
        Returns:
            List of 75 PVT corner combinations
        """
        corners = []
        voltages = [self.v_min, self.v_nom, self.v_max]
        temperatures = [self.temp_min, self.temp_nom, self.temp_max]
        
        corner_id = 0
        for process in self.process_corners:
            for voltage in voltages:
                for temperature in temperatures:
                    corner_name = f"{process}_v{voltage:.2f}_t{temperature:03d}"
                    corners.append(PVTCorner(
                        name=corner_name,
                        process=process,
                        voltage=voltage,
                        temperature=temperature
                    ))
                    corner_id += 1
        
        return corners
    
    def get_specification_margins(self, corner: PVTCorner) -> Dict[str, float]:
        """
        Get design specification margins for a given corner
        
        Args:
            corner: PVT corner specification
            
        Returns:
            Dict with margin values
        """
        # Base specifications at nominal conditions (0.8V, 25°C)
        base_specs = {
            'quiescent_current_ua': 45.0,
            'line_regulation_mv': 1.2,
            'load_regulation_mv': 0.8,
            'psrr_db': 65,
        }
        
        # Temperature coefficient (0.1%/°C)
        temp_shift = (corner.temperature - 25.0) * 0.001
        
        # Voltage sensitivity
        v_shift = (corner.voltage - self.v_nom) * 0.01
        
        # Process corner effects
        process_mults = {
            'tt': 1.0,
            'ss': 1.15,  # Slow-slow (higher current)
            'ff': 0.85,  # Fast-fast (lower current)
            'fs': 1.05,  # Fast-slow
            'sf': 0.95,  # Slow-fast
        }
        
        margins = {}
        for spec, value in base_specs.items():
            adjusted = value * (1.0 + temp_shift + v_shift) * process_mults[corner.process]
            margins[spec] = adjusted
        
        return margins
    
    def analyze_operating_region(self, 
                                 load_current_ma: float,
                                 corners: List[PVTCorner] = None) -> Dict[str, float]:
        """
        Analyze LDO performance across PVT corners
        
        Args:
            load_current_ma: Load current in mA
            corners: List of corners to analyze (if None, use all)
            
        Returns:
            Performance summary
        """
        if corners is None:
            corners = self.generate_corners()
        
        worst_dropout = 0.0
        worst_psrr = 100.0  # dB
        avg_quiescent = 0.0
        
        for corner in corners:
            margins = self.get_specification_margins(corner)
            
            # Estimate dropout voltage
            # Dropout = Id * Rds_on (pass transistor)
            rds_eff = 0.5 / (load_current_ma + 1e-6)  # Ohms
            dropout = load_current_ma * rds_eff
            worst_dropout = max(worst_dropout, dropout)
            
            # PSRR degrades at corners
            psrr_corner = margins['psrr_db']
            worst_psrr = min(worst_psrr, psrr_corner)
            
            avg_quiescent += margins['quiescent_current_ua']
        
        avg_quiescent /= len(corners)
        
        return {
            'worst_dropout_mv': worst_dropout * 1000,
            'worst_psrr_db': worst_psrr,
            'avg_quiescent_ua': avg_quiescent,
            'total_corners': len(corners)
        }
