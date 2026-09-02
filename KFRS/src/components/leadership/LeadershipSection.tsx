import { ASSETS } from "../../constants/assets";
import { Mail, Globe } from "lucide-react";

const LEADERS = [
  {
    name: "Jane Doe",
    title: "Secretary General",
    image: ASSETS.leaderDefault,
  },
  {
    name: "John Smith",
    title: "Technical Director",
    image: ASSETS.leaderDefault,
  },
  {
    name: "Alice Kipchoge",
    title: "Treasurer",
    image: ASSETS.leaderDefault,
  },
  {
    name: "David Omondi",
    title: "Youth Development",
    image: ASSETS.leaderDefault,
  },
];

export function LeadershipSection() {
  return (
    <section id="leadership" className="py-20 lg:py-28 bg-white relative overflow-hidden">
      {/* Decorative background element */}
      <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 bg-gray-50 rounded-full blur-3xl opacity-50 pointer-events-none" />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 text-kenya-black font-semibold mb-4 justify-center">
            <span className="w-8 h-1 bg-kenya-black rounded-full" />
            Governance
            <span className="w-8 h-1 bg-kenya-black rounded-full" />
          </div>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 mb-6">
            Leadership & Federation
          </h2>
        </div>

        {/* President Spotlight */}
        <div className="bg-kenya-black text-white rounded-3xl overflow-hidden shadow-2xl mb-16">
          <div className="grid md:grid-cols-2 items-center">
            <div className="h-full min-h-[400px] relative">
              <img
                src={ASSETS.presidentPortrait}
                alt="Tony Mburu - President"
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover object-top"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-kenya-black to-transparent md:bg-gradient-to-r md:from-transparent md:to-kenya-black" />
            </div>
            <div className="p-8 md:p-12 lg:p-16">
              <div className="inline-block px-3 py-1 bg-kenya-red text-white text-sm font-bold tracking-wider rounded-md mb-4 uppercase">
                President's Message
              </div>
              <h3 className="text-3xl lg:text-4xl font-bold mb-2">Tony Mburu</h3>
              <p className="text-kenya-gold font-medium mb-8">President, Kenya Federation of Roller Skating</p>
              
              <blockquote className="text-xl text-gray-300 italic mb-8 leading-relaxed border-l-4 border-kenya-red pl-6">
                "Our vision is to see a pair of skates in every household. We are building a foundation where every talented youth in Kenya has the opportunity to represent our nation on the global stage. Roller skating is not just a sport; it's a lifestyle of discipline and excellence."
              </blockquote>
              
              <div className="flex gap-4">
                <button className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
                  <Mail size={16} /> Contact Office
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Executive Committee */}
        <h3 className="text-2xl font-bold text-gray-900 mb-8 text-center">Executive Committee</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {LEADERS.map((leader, idx) => (
            <div key={idx} className="group text-center">
              <div className="relative w-48 h-48 mx-auto mb-6 rounded-full overflow-hidden border-4 border-gray-100 group-hover:border-kenya-red transition-colors shadow-md">
                <img
                  src={leader.image}
                  alt={leader.name}
                  loading="lazy"
                  className="w-full h-full object-cover transform group-hover:scale-110 transition-transform duration-500"
                />
              </div>
              <h4 className="text-xl font-bold text-gray-900 mb-1">{leader.name}</h4>
              <p className="text-kenya-red font-medium mb-3">{leader.title}</p>
              <div className="flex justify-center gap-3">
                <a href="#" className="text-gray-400 hover:text-kenya-black transition-colors"><Globe size={18} /></a>
                <a href="#" className="text-gray-400 hover:text-kenya-black transition-colors"><Mail size={18} /></a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
