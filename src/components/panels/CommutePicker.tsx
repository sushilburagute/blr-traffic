'use client';
import {
  Bike,
  Car,
  BusFront,
  Truck,
  CarTaxiFront,
  Navigation,
  Check,
  MoveRight,
  Shuffle,
  Zap,
} from 'lucide-react';
import {
  VEHICLE_TYPES,
  PROFILES,
  type VehicleType,
  type BehaviourProfile,
  type Cohort,
} from '@/sim/types';
import { VEHICLE_LABELS } from '@/lib/colors';
const icons = [Bike, Navigation, Car, CarTaxiFront, BusFront, Truck];
const behaviourIcons = [MoveRight, Shuffle, Zap];
const behaviourText = ['I follow my lane', 'I take gaps when I see them', 'Every gap is mine'];
export function CommutePicker({
  value,
  onChange,
}: {
  value: Cohort;
  onChange: (value: Cohort) => void;
}) {
  const [type, profile] = value.split(':') as [VehicleType, BehaviourProfile];
  return (
    <>
      <div className="step-title">
        <span>01</span>
        <h3>What’s your ride?</h3>
      </div>
      <div className="vehicle-grid">
        {VEHICLE_TYPES.map((t, i) => {
          const Icon = icons[i];
          return (
            <button
              className={`vehicle-card ${type === t ? 'selected' : ''}`}
              key={t}
              onClick={() => onChange(`${t}:${profile}`)}
              aria-pressed={type === t}
            >
              {type === t && <Check className="selection-check" size={14} />}
              <Icon size={29} strokeWidth={1.4} />
              <span>{VEHICLE_LABELS[t]}</span>
            </button>
          );
        })}
      </div>
      <div className="step-title">
        <span>02</span>
        <h3>And your driving style?</h3>
      </div>
      <div className="behaviour-list">
        {PROFILES.map((p, i) => {
          const Icon = behaviourIcons[i];
          return (
            <button
              key={p}
              className={`behaviour-card ${profile === p ? 'selected' : ''}`}
              aria-pressed={profile === p}
              onClick={() => onChange(`${type}:${p}`)}
            >
              <Icon size={19} />
              <span>{behaviourText[i]}</span>
              <span className="radio-dot">{profile === p && <i />}</span>
            </button>
          );
        })}
      </div>
      <p className="commute-note">
        You’ll follow a cohort of commuters like you. No steering required.
      </p>
    </>
  );
}
