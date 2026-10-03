interface ImportMetaEnv {
  readonly GOOGLE_MAPS_API_KEY?: string;
}

declare module 'tz-lookup' {
  export default function tzlookup(lat: number, lng: number): string;
}
