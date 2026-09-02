import { ArrowRight, Trophy, Users, MapPin, Calendar } from "lucide-react";
import { ASSETS } from "../../constants/assets";

const STATS = [
  { label: "Active Skaters", value: "3,500+", icon: Users },
  { label: "Affiliated Clubs", value: "28+", icon: Trophy },
  { label: "Counties", value: "14+", icon: MapPin },
  { label: "Championships", value: "12+", icon: Calendar },
];

export function Hero() {
  return (
    <section id="home" className="relative pt-24 pb-12 lg:pt-32 lg:pb-24 overflow-hidden bg-kenya-black">
      {/* Background Image with Overlay */}
      <div className="absolute inset-0 z-0">
        <img
          src={ASSETS.heroBanner}
          alt="KFRS skaters in action"
          className="w-full h-full object-cover object-center opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-kenya-black via-kenya-black/80 to-transparent" />
      </div>

      {/* Flag Accent Bar */}
      <div className="absolute top-0 left-0 right-0 h-1 flex z-10">
        <div className="h-full flex-1 bg-kenya-black"></div>
        <div className="h-full flex-1 bg-kenya-red"></div>
        <div className="h-full flex-1 bg-kenya-green"></div>
        <div className="h-full flex-1 bg-white"></div>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12 lg:mt-16">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-white/90 text-sm font-medium mb-6 backdrop-blur-sm">
            <span className="w-2 h-2 rounded-full bg-kenya-gold animate-pulse" />
            Official National Governing Body
          </div>
          
          <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold text-white leading-tight tracking-tight mb-6">
            Skating for <span className="text-kenya-red">Life</span>
          </h1>
          
          <p className="text-lg sm:text-xl text-gray-300 mb-10 max-w-2xl leading-relaxed text-balance">
            Empowering Kenyan skaters to excel locally and globally. We are the official federation dedicated to developing roller sports across all counties.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4">
            <a
              href="#programs"
              className="inline-flex justify-center items-center gap-2 bg-kenya-red hover:bg-kenya-red/90 text-white px-8 py-4 rounded-lg font-semibold text-lg transition-all transform hover:-translate-y-0.5 shadow-lg shadow-kenya-red/30"
            >
              Explore Programs
              <ArrowRight size={20} />
            </a>
            <a
              href="#contact"
              className="inline-flex justify-center items-center gap-2 bg-white/10 hover:bg-white/20 text-white border border-white/20 px-8 py-4 rounded-lg font-semibold text-lg transition-all backdrop-blur-sm"
            >
              Register as Athlete
            </a>
          </div>
        </div>

        {/* Stats Section */}
        <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-6 lg:gap-10">
          {STATS.map((stat, idx) => {
            const Icon = stat.icon;
            return (
              <div key={idx} className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 flex flex-col items-start gap-4 transform transition-transform hover:scale-105">
                <div className="p-3 bg-kenya-red/20 rounded-lg text-kenya-gold">
                  <Icon size={24} />
                </div>
                <div>
                  <h4 className="text-3xl font-bold text-white mb-1">{stat.value}</h4>
                  <p className="text-sm text-gray-400 font-medium">{stat.label}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
