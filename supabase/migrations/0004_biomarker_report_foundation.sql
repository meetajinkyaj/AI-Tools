-- Ikigaro — biomarker report foundation
-- Run in the Supabase SQL Editor (or via the Supabase CLI) AFTER 0003.
--
-- Foundation for the full biomarker report:
--   * schema for qualitative results, multi-band interpretation, derived
--     markers, and lab-provided reference ranges;
--   * expands biomarker_catalog from ~30 to ~80 markers covering every domain
--     of a full panel (lipids, metabolic, inflammation, cardiac, pancreas,
--     autoimmune, hematology + iron, thyroid, hormones, nutrients, liver,
--     kidney, screening, urine).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP NOT NULL, and INSERT ... ON
-- CONFLICT DO NOTHING, so it is safe to re-run.
--
-- CLINICAL SAFETY (unchanged from 0002): the seeded ranges are common,
-- unvalidated adult intervals for bootstrapping only (is_validated = false).
-- They are not clinically validated and must be reviewed before production.

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------
alter table biomarker_catalog
  add column if not exists result_kind text not null default 'numeric', -- 'numeric' | 'qualitative'
  add column if not exists is_derived boolean not null default false,
  add column if not exists normal_text text,   -- expected normal for qualitative markers
  add column if not exists bands jsonb not null default '[]'::jsonb; -- multi-band interpretation

alter table biomarker_readings
  add column if not exists value_text text,     -- qualitative result
  add column if not exists result_kind text not null default 'numeric',
  add column if not exists range_source text not null default 'catalog'; -- 'catalog' | 'lab' | 'user'

-- Qualitative readings have no numeric value.
alter table biomarker_readings alter column value drop not null;

-- ---------------------------------------------------------------------------
-- Catalog expansion (new markers only; existing 30 remain via ON CONFLICT)
-- ---------------------------------------------------------------------------
insert into biomarker_catalog
  (marker_key, display_name, category, unit, sex, ref_low, ref_high, direction, sort_order, is_derived, result_kind, normal_text)
values
  -- Lipids (extend)
  ('apo_b',          'Apolipoprotein B',        'lipids', 'mg/dL', 'any', 0,   100, 'lower_better', 15, false, 'numeric', null),
  ('lp_a',           'Lipoprotein(a)',          'lipids', 'mg/dL', 'any', 0,   30,  'lower_better', 16, false, 'numeric', null),
  ('non_hdl_c',      'Non-HDL Cholesterol',     'lipids', 'mg/dL', 'any', 0,   130, 'lower_better', 17, true,  'numeric', null),
  ('vldl',           'VLDL Cholesterol',        'lipids', 'mg/dL', 'any', 5,   40,  'in_range',     18, true,  'numeric', null),
  ('ldl_hdl_ratio',  'LDL / HDL Ratio',         'lipids', 'ratio', 'any', 0,   3.5, 'lower_better', 19, true,  'numeric', null),
  ('tc_hdl_ratio',   'Total / HDL Ratio',       'lipids', 'ratio', 'any', 0,   4.5, 'lower_better', 20, true,  'numeric', null),
  -- Metabolic (extend)
  ('hba1c_eag',      'Est. Average Glucose',    'metabolic', 'mg/dL', 'any', null, null, 'in_range', 25, true,  'numeric', null),
  -- Inflammation (extend)
  ('crp',            'CRP',                     'inflammation', 'mg/L', 'any', 0, 6,  'lower_better', 32, false, 'numeric', null),
  -- Cardiac
  ('nt_probnp',      'NT-proBNP',               'cardiac', 'pg/mL', 'any', 0,  125, 'lower_better', 34, false, 'numeric', null),
  -- Pancreas
  ('amylase',        'Amylase',                 'pancreas', 'U/L', 'any', 0,   90,  'in_range',     100, false, 'numeric', null),
  ('lipase',         'Lipase',                  'pancreas', 'U/L', 'any', 0,   60,  'in_range',     101, false, 'numeric', null),
  -- Autoimmune
  ('anti_ccp',       'Anti-CCP',                'autoimmune', 'U/mL', 'any', 0,  17, 'lower_better', 110, false, 'numeric', null),
  ('ra_factor',      'Rheumatoid Factor',       'autoimmune', 'IU/mL', 'any', 0, 15, 'lower_better', 111, false, 'numeric', null),
  -- Hematology (extend: CBC + iron studies)
  ('rbc',            'RBC Count',               'hematology', 'million/µL', 'male', 4.35, 5.65, 'in_range', 48, false, 'numeric', null),
  ('rbc',            'RBC Count',               'hematology', 'million/µL', 'female', 3.8, 5.1, 'in_range', 48, false, 'numeric', null),
  ('mcv',            'MCV',                     'hematology', 'fL', 'any', 80,  100, 'in_range', 50, false, 'numeric', null),
  ('mch',            'MCH',                     'hematology', 'pg', 'any', 27,  33,  'in_range', 51, false, 'numeric', null),
  ('mchc',           'MCHC',                    'hematology', 'g/dL', 'any', 32, 36, 'in_range', 52, false, 'numeric', null),
  ('rdw_cv',         'RDW-CV',                  'hematology', '%', 'any', 11.5, 14.5, 'in_range', 53, false, 'numeric', null),
  ('neutrophils_pct','Neutrophils',            'hematology', '%', 'any', 40,  70,  'in_range', 54, false, 'numeric', null),
  ('lymphocytes_pct','Lymphocytes',            'hematology', '%', 'any', 20,  40,  'in_range', 55, false, 'numeric', null),
  ('eosinophils_pct','Eosinophils',            'hematology', '%', 'any', 0,   6,   'in_range', 56, false, 'numeric', null),
  ('monocytes_pct',  'Monocytes',               'hematology', '%', 'any', 2,   10,  'in_range', 57, false, 'numeric', null),
  ('basophils_pct',  'Basophils',               'hematology', '%', 'any', 0,   2,   'in_range', 58, false, 'numeric', null),
  ('mpv',            'MPV',                     'hematology', 'fL', 'any', 7.5, 11.5, 'in_range', 59, false, 'numeric', null),
  ('iron',           'Iron',                    'hematology', 'µg/dL', 'any', 65, 175, 'in_range', 60, false, 'numeric', null),
  ('tibc',           'TIBC',                    'hematology', 'µg/dL', 'any', 250, 450, 'in_range', 61, false, 'numeric', null),
  ('uibc',           'UIBC',                    'hematology', 'µg/dL', 'any', 110, 370, 'in_range', 62, false, 'numeric', null),
  ('transferrin_saturation', 'Transferrin Saturation', 'hematology', '%', 'any', 20, 50, 'in_range', 63, false, 'numeric', null),
  -- Hormones (extend)
  ('estradiol',      'Estradiol (E2)',          'hormones', 'pg/mL', 'male', 10, 40,  'in_range', 63, false, 'numeric', null),
  ('estradiol',      'Estradiol (E2)',          'hormones', 'pg/mL', 'female', 15, 350, 'in_range', 64, false, 'numeric', null),
  ('cortisol_am',    'Cortisol (AM)',           'hormones', 'µg/dL', 'any', 6,  23,  'in_range', 65, false, 'numeric', null),
  ('dhea_s',         'DHEA-S',                  'hormones', 'µg/dL', 'male', 80, 560, 'in_range', 66, false, 'numeric', null),
  ('dhea_s',         'DHEA-S',                  'hormones', 'µg/dL', 'female', 35, 430, 'in_range', 67, false, 'numeric', null),
  ('psa',            'PSA',                     'hormones', 'ng/mL', 'male', 0, 4, 'lower_better', 68, false, 'numeric', null),
  -- Nutrients (extend)
  ('phosphorus',     'Phosphorus',              'nutrients', 'mg/dL', 'any', 2.5, 4.5, 'in_range', 74, false, 'numeric', null),
  -- Liver (extend)
  ('ast_alt_ratio',  'AST / ALT Ratio',         'liver', 'ratio', 'any', 0.7, 1.4, 'in_range', 84, true,  'numeric', null),
  ('bilirubin_direct','Direct Bilirubin',       'liver', 'mg/dL', 'any', 0,   0.3, 'in_range', 85, false, 'numeric', null),
  ('bilirubin_indirect','Indirect Bilirubin',   'liver', 'mg/dL', 'any', 0,   1.0, 'in_range', 86, false, 'numeric', null),
  ('alp',            'Alkaline Phosphatase',    'liver', 'U/L', 'any', 40,  130, 'in_range', 87, false, 'numeric', null),
  ('total_protein',  'Total Protein',           'liver', 'g/dL', 'any', 6.4, 8.3, 'in_range', 88, false, 'numeric', null),
  ('globulin',       'Globulin',                'liver', 'g/dL', 'any', 2.0, 3.5, 'in_range', 89, false, 'numeric', null),
  ('ag_ratio',       'A / G Ratio',             'liver', 'ratio', 'any', 1.0, 2.5, 'in_range', 90, true,  'numeric', null),
  -- Kidney (extend)
  ('urea',           'Urea',                    'kidney', 'mg/dL', 'any', 17,  49,  'in_range', 96, false, 'numeric', null),
  ('chloride',       'Chloride',                'kidney', 'mmol/L', 'any', 97, 110, 'in_range', 97, false, 'numeric', null),
  ('microalbumin_creatinine_ratio', 'Microalbumin / Creatinine', 'kidney', 'mg/g', 'any', 0, 30, 'lower_better', 98, false, 'numeric', null),
  -- Screening (qualitative)
  ('hiv',            'HIV I/II',                'screening', '', 'any', null, null, 'in_range', 120, false, 'qualitative', 'Negative'),
  ('hcv',            'Hepatitis C (HCV)',       'screening', '', 'any', null, null, 'in_range', 121, false, 'qualitative', 'Negative'),
  ('hbsag',          'Hepatitis B (HBsAg)',     'screening', '', 'any', null, null, 'in_range', 122, false, 'qualitative', 'Non-reactive'),
  -- Urine (qualitative)
  ('urine_protein',  'Urine Protein',           'urine', '', 'any', null, null, 'in_range', 130, false, 'qualitative', 'Negative'),
  ('urine_glucose',  'Urine Glucose',           'urine', '', 'any', null, null, 'in_range', 131, false, 'qualitative', 'Negative'),
  ('urine_ketones',  'Urine Ketones',           'urine', '', 'any', null, null, 'in_range', 132, false, 'qualitative', 'Negative'),
  ('urine_blood',    'Urine Blood',             'urine', '', 'any', null, null, 'in_range', 133, false, 'qualitative', 'Absent')
on conflict (marker_key, sex) do nothing;

-- ---------------------------------------------------------------------------
-- Multi-band interpretation for markers that read as bands (idempotent UPDATEs).
-- ---------------------------------------------------------------------------
update biomarker_catalog set bands =
  '[{"label":"Deficiency","high":20,"severity":"low"},
    {"label":"Insufficiency","low":20,"high":30,"severity":"borderline"},
    {"label":"Sufficiency","low":30,"high":100,"severity":"optimal"},
    {"label":"Toxicity","low":100,"severity":"high"}]'::jsonb
where marker_key = 'vitamin_d_25oh';

update biomarker_catalog set bands =
  '[{"label":"Normal","high":5.7,"severity":"optimal"},
    {"label":"Prediabetes","low":5.7,"high":6.5,"severity":"borderline"},
    {"label":"Diabetes","low":6.5,"severity":"high"}]'::jsonb
where marker_key = 'hba1c';

update biomarker_catalog set bands =
  '[{"label":"Desirable","high":200,"severity":"optimal"},
    {"label":"Borderline high","low":200,"high":240,"severity":"borderline"},
    {"label":"High","low":240,"severity":"high"}]'::jsonb
where marker_key = 'total_cholesterol';

update biomarker_catalog set bands =
  '[{"label":"Optimal","high":100,"severity":"optimal"},
    {"label":"Near optimal","low":100,"high":130,"severity":"borderline"},
    {"label":"Borderline high","low":130,"high":160,"severity":"borderline"},
    {"label":"High","low":160,"severity":"high"}]'::jsonb
where marker_key = 'ldl_c';

update biomarker_catalog set bands =
  '[{"label":"Desirable","high":150,"severity":"optimal"},
    {"label":"Borderline high","low":150,"high":200,"severity":"borderline"},
    {"label":"High","low":200,"severity":"high"}]'::jsonb
where marker_key = 'triglycerides';
