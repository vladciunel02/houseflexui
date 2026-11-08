import * as THREE from 'three';

export function readToken(name: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function threeColor(name: string): THREE.Color {
  return new THREE.Color(readToken(name));
}
