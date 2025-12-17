# 🚀 QUICKSTART: Setup Your LDO Project Locally

## One-Command Setup (Recommended)

The easiest way to set up the entire project is to run the automated setup script:

```bash
# Clone the repository
git clone https://github.com/j143/ldo.git
cd ldo

# Run the setup script (creates all files automatically)
python3 scripts/generate_project.py

# Install dependencies
pip install -r requirements.txt

# Run the simulations
python3 scripts/run_all_simulations.py
```

## Manual Setup (If Needed)

If you prefer manual setup, follow these steps:

### 1. Clone Repository
```bash
git clone https://github.com/j143/ldo.git
cd ldo
```

### 2. Create Virtual Environment
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 3. Install Dependencies
```bash
pip install -r requirements.txt
```

### 4. Generate Project Files
The repository includes a `scripts/generate_project.py` script that generates all project files. Run:
```bash
python3 scripts/generate_project.py
```

This will create:
- `src/` directory with 6 circuit simulation modules
- `scripts/` directory with 5 day-by-day simulation scripts
- `docs/` directory with 10+ documentation files
- `data/` directory with configuration and results

### 5. Run the Week's Simulations
```bash
python3 scripts/run_all_simulations.py
```

## Directory Structure (After Setup)

```
ldo/
├── src/                          # Python simulation modules
│   ├── circuit_simulator.py      # LDO transient analysis
│   ├── lco_detector.py           # Limit cycle oscillation
│   ├── pmos_array_model.py       # PMOS pass device simulation
│   ├── pvt_corner_analysis.py    # 75-corner PVT verification
│   ├── em_checker.py             # Electromigration analysis
│   └── layout_effects.py          # FinFET layout effects
│
├── scripts/                      # Executable simulation scripts
│   ├── run_all_simulations.py   # Master workflow runner
│   ├── generate_project.py       # Auto-generates all files
│   ├── monday_load_step.py       # Monday: Load transient
│   ├── tuesday_lco.py            # Tuesday: Oscillation mitigation
│   ├── wednesday_layout.py       # Wednesday: Layout effects
│   ├── thursday_pvt.py           # Thursday: PVT corners
│   └── friday_em.py              # Friday: Sign-off checks
│
├── data/                         # Configuration & results
│   ├── specs.json               # Design specifications
│   ├── process_corners.json     # 75 PVT corners
│   └── results/                 # Simulation outputs
│
├── docs/                         # Documentation
│   ├── START_HERE.md
│   ├── GETTING_STARTED.md
│   ├── DESIGN_SPEC.md
│   ├── IMPLEMENTATION_ROADMAP.md
│   ├── REPOSITORY_STRUCTURE.md
│   └── ... (10+ guides)
│
├── requirements.txt             # Python dependencies
├── README.md                    # Project overview
├── LICENSE                      # MIT License
└── .gitignore                   # Git ignore rules
```

## Quick Test (5 minutes)

After setup, test with:
```bash
# Run single day simulation
python3 scripts/monday_load_step.py

# View results
cat data/results/monday_transient.json
```

## What Happens During Setup

The `generate_project.py` script creates all necessary files:

✅ **1,400+ lines of Python code** across 6 modules
✅ **2,500+ lines of documentation** across 10+ guides
✅ **5 day-by-day simulation scripts** matching real workflow
✅ **Configuration files** with realistic 5nm parameters
✅ **Data files** with 75 PVT corner definitions

## Troubleshooting

### ImportError: No module named 'numpy'
```bash
pip install --upgrade pip
pip install -r requirements.txt
```

### Permission denied on scripts
```bash
chmod +x scripts/*.py
```

### Python version issue
Requires Python 3.8+. Check with:
```bash
python3 --version
```

## Next Steps

1. **Start with Day 1**: Read `docs/DESIGN_SPEC.md`
2. **Run Monday simulation**: `python3 scripts/monday_load_step.py`
3. **Review output**: Check `data/results/`
4. **Deep dive**: Follow `docs/IMPLEMENTATION_ROADMAP.md`

## References

- **ISSCC Papers**: Digital LDO for AI accelerators (2024-2025)
- **Process**: 5nm FinFET with realistic DLDO design
- **Framework**: Circuit simulation + verification
- **Use Case**: Role-play as Senior Analog Design Engineer

---

**Questions?** Check `docs/INDEX.md` for complete navigation.

**Ready to start?** Run: `python3 scripts/generate_project.py && python3 scripts/run_all_simulations.py`
