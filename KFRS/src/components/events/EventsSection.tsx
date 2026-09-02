import { CalendarDays, MapPin, Clock } from "lucide-react";
import { ASSETS } from "../../constants/assets";
import type { EventItem } from "../../types";

const EVENTS: EventItem[] = [
  {
    id: "nat-champ-24",
    title: "National Roller Skating Championship",
    date: "November 15-17, 2026",
    venue: "Kasarani Sports Complex, Nairobi",
    category: "Speed & Freestyle",
    image: ASSETS.eventDefault,
    status: "upcoming",
    description: "The premier national event featuring the top athletes from across the country competing for national titles.",
  },
  {
    id: "youth-clinic",
    title: "Kenya Youth Roller Clinic",
    date: "December 5, 2026",
    venue: "Nairobi City Park",
    category: "Grassroots",
    image: ASSETS.eventDefault,
    status: "upcoming",
    description: "A free introductory clinic for kids aged 5-14 to learn the basics of roller skating.",
  },
  {
    id: "coach-cert",
    title: "Level 1 Coaching Certification",
    date: "January 10-12, 2027",
    venue: "Mombasa Sports Club",
    category: "Education",
    image: ASSETS.eventDefault,
    status: "upcoming",
    description: "Official KFRS and World Skate recognized coaching certification course.",
  }
];

export function EventsSection() {
  return (
    <section id="events" className="py-20 lg:py-28 bg-gray-50 border-t border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 text-kenya-red font-semibold mb-4">
              <span className="w-8 h-1 bg-kenya-red rounded-full" />
              Calendar
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900">Upcoming Events & Programs</h2>
          </div>
          <button className="shrink-0 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:text-kenya-red px-6 py-3 rounded-lg font-semibold transition-colors shadow-sm">
            View Full Calendar
          </button>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {EVENTS.map((event) => (
            <div key={event.id} className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-100 flex flex-col">
              <div className="relative h-48">
                <img src={event.image} alt={event.title} loading="lazy" className="w-full h-full object-cover" />
                <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm text-kenya-black px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                  {event.category}
                </div>
              </div>
              <div className="p-6 flex flex-col flex-grow">
                <h3 className="text-xl font-bold text-gray-900 mb-4">{event.title}</h3>
                
                <div className="space-y-3 mb-6 flex-grow">
                  <div className="flex items-center gap-3 text-gray-600">
                    <CalendarDays className="text-kenya-red shrink-0" size={18} />
                    <span className="text-sm font-medium">{event.date}</span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-600">
                    <MapPin className="text-kenya-red shrink-0" size={18} />
                    <span className="text-sm font-medium">{event.venue}</span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-600">
                    <Clock className="text-kenya-red shrink-0" size={18} />
                    <span className="text-sm font-medium">Registration Open</span>
                  </div>
                </div>
                
                <button className="w-full bg-kenya-black hover:bg-kenya-red text-white py-3 rounded-lg font-semibold transition-colors mt-auto">
                  Register Now
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
