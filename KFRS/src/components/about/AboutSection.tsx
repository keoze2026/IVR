import { ShieldCheck, Target, GraduationCap, Medal } from "lucide-react";
import { ASSETS } from "../../constants/assets";

const MANDATES = [
  {
    title: "Governance & Rules",
    description: "Setting national standards, safety guidelines, and sporting rules in alignment with World Skate.",
    icon: ShieldCheck,
  },
  {
    title: "Talent Development",
    description: "Creating structured pathways from grassroots school clinics to the national team (Team Kenya).",
    icon: Target,
  },
  {
    title: "Coaching & Certification",
    description: "Providing world-class training and certification for coaches, referees, and technical officials.",
    icon: GraduationCap,
  },
  {
    title: "National Championships",
    description: "Organizing elite competitions including the Kasarani Grand Prix and National Roller Skating Championships.",
    icon: Medal,
  },
];

export function AboutSection() {
  return (
    <section id="about" className="py-20 lg:py-28 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          
          {/* Image Side */}
          <div className="relative group">
            <div className="absolute -inset-4 bg-kenya-red/10 rounded-2xl transform rotate-3 transition-transform group-hover:rotate-1" />
            <div className="absolute -inset-4 bg-kenya-green/10 rounded-2xl transform -rotate-3 transition-transform group-hover:-rotate-1" />
            <img
              src={ASSETS.aboutImage}
              alt="KFRS overview and skaters"
              loading="lazy"
              className="relative rounded-2xl shadow-xl w-full object-cover aspect-4/3"
            />
            {/* Badge */}
            <div className="absolute -bottom-6 -right-6 bg-kenya-black text-white p-6 rounded-2xl shadow-xl hidden md:block">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-kenya-red rounded-full">
                  <ShieldCheck size={24} className="text-white" />
                </div>
                <div>
                  <p className="text-sm text-gray-400 font-medium">Affiliated with</p>
                  <p className="text-lg font-bold">World Skate</p>
                </div>
              </div>
            </div>
          </div>

          {/* Content Side */}
          <div>
            <div className="inline-flex items-center gap-2 text-kenya-red font-semibold mb-4">
              <span className="w-8 h-1 bg-kenya-red rounded-full" />
              About KFRS
            </div>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 mb-6 leading-tight">
              Leading the Roller Sports Revolution in Kenya
            </h2>
            <p className="text-lg text-gray-600 mb-8 leading-relaxed">
              The Kenya Federation of Roller Skating (KFRS) is the officially recognized national governing body for all roller sports disciplines in Kenya. We are committed to fostering a vibrant skating culture, ensuring safety, and building champions.
            </p>

            <div className="grid sm:grid-cols-2 gap-6">
              {MANDATES.map((mandate, idx) => {
                const Icon = mandate.icon;
                return (
                  <div key={idx} className="flex gap-4">
                    <div className="shrink-0 mt-1 p-2 bg-gray-50 text-kenya-red rounded-lg border border-gray-100">
                      <Icon size={20} />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">{mandate.title}</h4>
                      <p className="text-sm text-gray-600 leading-relaxed">{mandate.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            
            <div className="mt-10 pt-8 border-t border-gray-100">
              <p className="text-sm text-gray-500 font-medium mb-4 uppercase tracking-wider">Official Partners</p>
              <div className="flex flex-wrap gap-8 items-center opacity-70 grayscale">
                <img src={ASSETS.partnerDefault} alt="Partner Logo" className="h-8 object-contain" />
                <img src={ASSETS.partnerDefault} alt="Partner Logo" className="h-8 object-contain" />
                <img src={ASSETS.partnerDefault} alt="Partner Logo" className="h-8 object-contain" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
