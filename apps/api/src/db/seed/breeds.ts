import type { Db } from '../connection';

export const BREED_IDS = {
  ckcs: 'breed_ckcs',
  lab: 'breed_lab',
  dogGeneric: 'breed_dog_generic',
  catDsh: 'breed_cat_dsh',
} as const;

const BREEDS = [
  {
    id: BREED_IDS.ckcs,
    species: 'dog',
    breed_name: 'Cavalier King Charles Spaniel',
    size_class: 'small',
    resting_hr_low: 90,
    resting_hr_high: 140,
    common_conditions: [
      { condition: 'mitral valve disease', typical_onset: 'age 5-7 for half the breed, near all by 10-11', monitorable_today: true },
      { condition: 'hip and patellar issues', typical_onset: 'middle age onward', monitorable_today: true },
      { condition: 'obesity tendency', typical_onset: 'any age', monitorable_today: true },
      { condition: 'syringomyelia', typical_onset: 'young adult onward', monitorable_today: false },
      { condition: 'ear infections', typical_onset: 'any age', monitorable_today: false },
    ],
    is_generic_fallback: 0,
  },
  {
    id: BREED_IDS.lab,
    species: 'dog',
    breed_name: 'Labrador Retriever',
    size_class: 'large',
    resting_hr_low: 60,
    resting_hr_high: 100,
    common_conditions: [
      { condition: 'hip and elbow dysplasia', typical_onset: 'middle age onward', monitorable_today: true },
      { condition: 'obesity tendency', typical_onset: 'any age', monitorable_today: true },
    ],
    is_generic_fallback: 0,
  },
  {
    id: BREED_IDS.dogGeneric,
    species: 'dog',
    breed_name: null,
    size_class: 'n/a',
    resting_hr_low: 70,
    resting_hr_high: 120,
    common_conditions: [],
    is_generic_fallback: 1,
  },
  {
    id: BREED_IDS.catDsh,
    species: 'cat',
    breed_name: 'Domestic Shorthair',
    size_class: 'n/a',
    resting_hr_low: 150,
    resting_hr_high: 200,
    common_conditions: [
      { condition: 'chronic kidney disease', typical_onset: 'senior years', monitorable_today: false },
      { condition: 'hyperthyroidism', typical_onset: 'senior years', monitorable_today: false },
    ],
    is_generic_fallback: 0,
  },
];

export function seedBreedProfiles(db: Db): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO breed_profiles
      (id, species, breed_name, size_class, resting_hr_low, resting_hr_high, common_conditions, is_generic_fallback)
    VALUES (@id, @species, @breed_name, @size_class, @resting_hr_low, @resting_hr_high, @common_conditions, @is_generic_fallback)
  `);
  for (const b of BREEDS) {
    stmt.run({ ...b, common_conditions: JSON.stringify(b.common_conditions) });
  }
}
