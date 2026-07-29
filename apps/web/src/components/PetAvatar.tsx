import { petPhotoUrl } from '../api/client';

/**
 * A pet's face: the owner-provided profile photo (served by the authenticated
 * photo endpoint) inside the brand-yellow circle, or the species emoji when no
 * photo is on the profile.
 */
export function PetAvatar({
  petId,
  species,
  hasPhoto,
  size = 'md',
}: {
  petId: string;
  species: string;
  hasPhoto: boolean | number | undefined;
  size?: 'sm' | 'md' | 'lg';
}) {
  const cls = { sm: 'h-12 w-12 text-2xl', md: 'h-16 w-16 text-3xl', lg: 'h-20 w-20 text-4xl' }[size];
  return (
    <div className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-brand ${cls}`} aria-hidden>
      {hasPhoto ? (
        <img src={petPhotoUrl(petId)} alt="" className="h-full w-full object-cover" />
      ) : (
        <span>{species === 'dog' ? '🐶' : species === 'cat' ? '🐱' : '🐾'}</span>
      )}
    </div>
  );
}
