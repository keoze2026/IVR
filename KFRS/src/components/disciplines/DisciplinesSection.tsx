import { ASSETS } from "../../constants/assets";
import { ArrowRight } from "lucide-react";
import type { Discipline } from "../../types";

const DISCIPLINES: Discipline[] = [
  {
    id: "speed-skating",
    name: "Speed Skating",
    description: "Track and road racing events requiring endurance, strategy, and explosive speed.",
    image: ASSETS.disciplines.speed,
  },
  {
    id: "freestyle",
    name: "Inline Freestyle",
    description: "Technical maneuvers around cones, including slalom, slides, and free jump.",
    image: ASSETS.disciplines.freestyle,
  },
  {
    id: "hockey",
    name: "Inline Hockey",
    description: "High-paced team sport played on inline skates with a puck or ball.",
    image: ASSETS.disciplines.hockey,
  },
  {
    id: "roller-derby",
    name: "Roller Derby",
    description: "Contact sport played on quad skates, focusing on strategy, speed, and teamwork.",
    image: ASSETS.disciplines.rollerDerby,
  },
  {
    id: "artistic",
    name: "Artistic Skating",
    description: "Figure skating on roller skates featuring jumps, spins, and choreography.",
    image: ASSETS.disciplines.artistic,
  },
  {
    id: "recreational",
    name: "Recreational & Grassroots",
    description: "Community skating, fitness, and youth development programs.",
    image: ASSETS.disciplines.recreational,
  },
];

export function DisciplinesSection() {
  return (
    <section id="disciplines" className="py-20 lg:py-28 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 text-kenya-green font-semibold mb-4 justify-center">
            <span className="w-8 h-1 bg-kenya-green rounded-full" />
            Official Disciplines
            <span className="w-8 h-1 bg-kenya-green rounded-full" />
          </div>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 mb-6">
            Discover Roller Sports
          </h2>
          <p className="text-lg text-gray-600">
            KFRS oversees and promotes a diverse range of roller sports disciplines, providing pathways for athletes of all interests and abilities.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {DISCIPLINES.map((discipline) => (
            <div key={discipline.id} className="group bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-100 flex flex-col">
              <div className="relative h-64 overflow-hidden">
                <div className="absolute inset-0 bg-kenya-black/20 group-hover:bg-transparent transition-colors z-10" />
                <img
                  src={discipline.image}
                  alt={discipline.name}
                  loading="lazy"
                  className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500"
                />
              </div>
              <div className="p-8 flex flex-col flex-grow">
                <h3 className="text-2xl font-bold text-gray-900 mb-3">{discipline.name}</h3>
                <p className="text-gray-600 mb-6 flex-grow">{discipline.description}</p>
                <a href="#" className="inline-flex items-center gap-2 text-kenya-red font-semibold hover:text-kenya-red/80 transition-colors group/link">
                  Learn more
                  <ArrowRight size={18} className="transform group-hover/link:translate-x-1 transition-transform" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
