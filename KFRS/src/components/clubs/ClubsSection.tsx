import { MapPin, ArrowRight } from "lucide-react";
import { ASSETS } from "../../constants/assets";
import type { ClubPartner } from "../../types";

const CLUBS: ClubPartner[] = [
  {
    id: "nairobi-speed",
    name: "Nairobi Speed Rollers",
    type: "club",
    county: "Nairobi",
    logo: ASSETS.partnerDefault,
  },
  {
    id: "mombasa-coastal",
    name: "Coastal Skaters",
    type: "club",
    county: "Mombasa",
    logo: ASSETS.partnerDefault,
  },
  {
    id: "eldoret-inline",
    name: "Eldoret Inline Club",
    type: "club",
    county: "Uasin Gishu",
    logo: ASSETS.partnerDefault,
  },
  {
    id: "kisumu-blades",
    name: "Kisumu Blades",
    type: "club",
    county: "Kisumu",
    logo: ASSETS.partnerDefault,
  },
];

export function ClubsSection() {
  return (
    <section id="clubs" className="py-20 lg:py-28 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 text-kenya-green font-semibold mb-4 justify-center">
            <span className="w-8 h-1 bg-kenya-green rounded-full" />
            Affiliated Clubs
            <span className="w-8 h-1 bg-kenya-green rounded-full" />
          </div>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 mb-6">
            Find a Club Near You
          </h2>
          <p className="text-lg text-gray-600">
            Join one of our 28+ affiliated clubs across 14 counties. Whether you're a beginner or an elite athlete, there's a community waiting for you.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          {CLUBS.map((club) => (
            <div key={club.id} className="bg-gray-50 rounded-xl p-6 border border-gray-100 hover:border-kenya-green/50 hover:shadow-md transition-all group">
              <div className="h-16 mb-6 flex items-center justify-start opacity-70 group-hover:opacity-100 transition-opacity">
                <img src={club.logo} alt={club.name} loading="lazy" className="h-full object-contain" />
              </div>
              <h3 className="font-bold text-gray-900 mb-2">{club.name}</h3>
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
                <MapPin size={14} className="text-kenya-green" />
                {club.county} County
              </div>
              <button className="text-sm font-semibold text-kenya-green flex items-center gap-1 hover:text-kenya-green/80 transition-colors">
                Contact Club <ArrowRight size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="bg-kenya-green text-white rounded-2xl p-8 md:p-12 flex flex-col md:flex-row items-center justify-between gap-8 shadow-xl">
          <div className="max-w-xl">
            <h3 className="text-2xl md:text-3xl font-bold mb-4">Want to affiliate your club with KFRS?</h3>
            <p className="text-kenya-white/80">Get access to national leagues, certified coaching clinics, and official federation support.</p>
          </div>
          <a href="#contact" className="shrink-0 bg-white text-kenya-green hover:bg-gray-50 px-8 py-4 rounded-lg font-bold transition-colors shadow-lg">
            Apply for Affiliation
          </a>
        </div>
      </div>
    </section>
  );
}
