"""PMOS array model for LDO pass transistor

Models PMOS transistor array behavior, including:
- Drain current vs Vgs/Vds
- Temperature and process variation effects
- Parasitic resistance
"""

import numpy as np
from typing import Tuple, Dict


class PMOSArrayModel:
    """Multi-finger PMOS array model"""
    
    def __init__(self, num_fingers: int = 1, w_um: float = 100.0, l_um: float = 0.5):
        """
        Args:
            num_fingers: Number of PMOS fingers
            w_um: Total transistor width in micrometers
            l_um: Channel length in micrometers
        """
        self.num_fingers = num_fingers
        self.w_um = w_um
        self.l_um = l_um
        self.w_per_finger = w_um / num_fingers if num_fingers > 0 else w_um
        
        # Process parameters for 5nm node
        self.vth_nominal = -0.35  # V (Vth for PMOS)
        self.kp = 180e-6  # A/V^2 (transconductance parameter)
        self.lambda_param = 0.05  # Channel length modulation
        
    def calculate_id(self, vgs: float, vds: float, temp_c: float = 25.0) -> float:
        """
        Calculate drain current for PMOS array
        
        Args:
            vgs: Gate-source voltage (V)
            vds: Drain-source voltage (V) 
            temp_c: Temperature (Celsius)
            
        Returns:
            Total drain current (A)
        """
        # Temperature coefficient
        temp_coeff = 1.0 - 0.001 * (temp_c - 25.0)
        
        # Effective Vgs (magnitude for PMOS)
        vgs_eff = abs(vgs - self.vth_nominal)
        
        if vgs_eff <= 0:
            return 0.0
            
        # Saturation voltage
        vsat = vgs_eff / 2.0
        
        if abs(vds) >= vsat:  # Saturation region
            id_sat = self.kp * (self.w_um / self.l_um) * (vgs_eff ** 2) / 2.0
            id_total = id_sat * (1.0 + self.lambda_param * abs(vds))
        else:  # Linear region
            id_linear = self.kp * (self.w_um / self.l_um) * (vgs_eff * abs(vds) - (vds ** 2) / 2.0)
            id_total = id_linear * (1.0 + self.lambda_param * abs(vds))
        
        # Apply temperature correction
        id_total *= temp_coeff
        
        return id_total * self.num_fingers
    
    def calculate_gm(self, vgs: float, vds: float, temp_c: float = 25.0) -> float:
        """
        Calculate transconductance
        
        Args:
            vgs: Gate-source voltage (V)
            vds: Drain-source voltage (V)
            temp_c: Temperature (Celsius)
            
        Returns:
            Transconductance (S)
        """
        vgs_eff = abs(vgs - self.vth_nominal)
        
        if vgs_eff <= 0:
            return 0.0
        
        # Temperature coefficient
        temp_coeff = 1.0 - 0.001 * (temp_c - 25.0)
        
        # gm = kp * (W/L) * (Vgs - Vth) in saturation
        gm = self.kp * (self.w_um / self.l_um) * vgs_eff * temp_coeff * self.num_fingers
        
        return gm
    
    def get_process_corner(self, corner: str = 'tt') -> Dict[str, float]:
        """
        Get process corner parameters
        
        Args:
            corner: Process corner ('tt', 'ss', 'ff', 'fs', 'sf')
            
        Returns:
            Dict with adjusted parameters
        """
        corners = {
            'tt': {'vth_shift': 0.0, 'kp_mult': 1.0},      # Typical-typical
            'ss': {'vth_shift': -0.05, 'kp_mult': 0.85},    # Slow-slow
            'ff': {'vth_shift': 0.05, 'kp_mult': 1.15},     # Fast-fast
            'fs': {'vth_shift': 0.03, 'kp_mult': 1.10},     # Fast-slow
            'sf': {'vth_shift': -0.03, 'kp_mult': 0.90},    # Slow-fast
        }
        return corners.get(corner, corners['tt'])
