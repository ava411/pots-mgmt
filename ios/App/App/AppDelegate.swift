import UIKit
import Capacitor
import HealthKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

// MARK: - POTS Tracker native layer

/// The app's main screen: Capacitor's web view, with the Apple Health plugin registered.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HealthDataPlugin())
    }
}

/// Reads Apple Health on the device and hands the web app one summary per day. Nothing leaves the phone.
/// Apple Watch and WHOOP both write to Apple Health, so this covers either.
@objc(HealthDataPlugin)
public class HealthDataPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthDataPlugin"
    public let jsName = "HealthData"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readDays", returnType: CAPPluginReturnPromise)
    ]
    private let store = HKHealthStore()

    private var readTypes: Set<HKObjectType> {
        var types = Set<HKObjectType>()
        for id in [HKQuantityTypeIdentifier.restingHeartRate, .heartRateVariabilitySDNN, .stepCount] {
            if let t = HKObjectType.quantityType(forIdentifier: id) { types.insert(t) }
        }
        for id in [HKCategoryTypeIdentifier.sleepAnalysis, .menstrualFlow] {
            if let t = HKObjectType.categoryType(forIdentifier: id) { types.insert(t) }
        }
        types.insert(HKObjectType.workoutType())
        return types
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.reject("Apple Health is not available on this device"); return }
        store.requestAuthorization(toShare: nil, read: readTypes) { ok, error in
            if let error = error { call.reject(error.localizedDescription); return }
            call.resolve(["granted": ok])
        }
    }

    /// Days from `from` to `to` (local YYYY-MM-DD): resting heart rate and HRV (daily averages), steps (daily sum),
    /// hours asleep (counted on the day you woke, one source per night so devices don't add up), workouts, and
    /// whether there was menstrual flow.
    @objc func readDays(_ call: CAPPluginCall) {
        guard let fromText = call.getString("from"), let toText = call.getString("to"),
              let fromDay = Self.dayFormat.date(from: fromText), let toDay = Self.dayFormat.date(from: toText) else {
            call.reject("from and to are required, as YYYY-MM-DD"); return
        }
        let cal = Calendar.current
        let start = cal.startOfDay(for: fromDay)
        guard let end = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: toDay)),
              let sleepStart = cal.date(byAdding: .hour, value: -18, to: start) else { call.reject("bad dates"); return }
        let out = DayBox()
        let group = DispatchGroup()

        func daily(_ id: HKQuantityTypeIdentifier, _ options: HKStatisticsOptions, _ unit: HKUnit, _ key: String) {
            guard let type = HKObjectType.quantityType(forIdentifier: id) else { return }
            group.enter()
            let query = HKStatisticsCollectionQuery(quantityType: type,
                                                    quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: end, options: []),
                                                    options: options, anchorDate: start, intervalComponents: DateComponents(day: 1))
            query.initialResultsHandler = { _, results, _ in
                results?.enumerateStatistics(from: start, to: end) { stats, _ in
                    let quantity = options.contains(.cumulativeSum) ? stats.sumQuantity() : stats.averageQuantity()
                    if let v = quantity?.doubleValue(for: unit) { out.put(Self.dayFormat.string(from: stats.startDate), key, Int(v.rounded())) }
                }
                group.leave()
            }
            store.execute(query)
        }
        daily(.restingHeartRate, .discreteAverage, HKUnit.count().unitDivided(by: HKUnit.minute()), "rhr")
        daily(.heartRateVariabilitySDNN, .discreteAverage, HKUnit.secondUnit(with: .milli), "hrv")
        daily(.stepCount, .cumulativeSum, HKUnit.count(), "steps")

        if let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            group.enter()
            let query = HKSampleQuery(sampleType: sleepType, predicate: HKQuery.predicateForSamples(withStart: sleepStart, end: end, options: []),
                                      limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
                var bySource: [String: [String: TimeInterval]] = [:]
                for sample in (samples as? [HKCategorySample]) ?? [] where Self.isAsleep(sample.value) {
                    let day = Self.dayFormat.string(from: sample.endDate), source = sample.sourceRevision.source.bundleIdentifier
                    bySource[day, default: [:]][source, default: 0] += sample.endDate.timeIntervalSince(sample.startDate)
                }
                for (day, sources) in bySource {
                    if let seconds = sources.values.max(), seconds > 0 { out.put(day, "sleepHours", (seconds / 360).rounded() / 10) }
                }
                group.leave()
            }
            store.execute(query)
        }

        group.enter()
        let workouts = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: HKQuery.predicateForSamples(withStart: start, end: end, options: []),
                                     limit: HKObjectQueryNoLimit, sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]) { _, samples, _ in
            var byDay: [String: [[String: Any]]] = [:]
            for w in (samples as? [HKWorkout]) ?? [] {
                byDay[Self.dayFormat.string(from: w.startDate), default: []].append(["name": Self.name(of: w.workoutActivityType), "minutes": Int((w.duration / 60).rounded())])
            }
            for (day, list) in byDay { out.put(day, "workouts", list) }
            group.leave()
        }
        store.execute(workouts)

        if let flowType = HKObjectType.categoryType(forIdentifier: .menstrualFlow) {
            group.enter()
            let query = HKSampleQuery(sampleType: flowType, predicate: HKQuery.predicateForSamples(withStart: start, end: end, options: []),
                                      limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
                for sample in (samples as? [HKCategorySample]) ?? [] where sample.value != HKCategoryValueMenstrualFlow.none.rawValue {
                    out.put(Self.dayFormat.string(from: sample.startDate), "flow", true)
                }
                group.leave()
            }
            store.execute(query)
        }

        group.notify(queue: .main) { call.resolve(["days": out.all()]) }
    }

    /// One dictionary per day, filled from several HealthKit queries at once.
    final class DayBox {
        private var days: [String: [String: Any]] = [:]
        private let lock = NSLock()
        func put(_ day: String, _ key: String, _ value: Any) { lock.lock(); days[day, default: [:]][key] = value; lock.unlock() }
        func all() -> [String: Any] { lock.lock(); defer { lock.unlock() }; return days }
    }

    static let dayFormat: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone.current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func isAsleep(_ value: Int) -> Bool {
        if #available(iOS 16.0, *) {
            return [HKCategoryValueSleepAnalysis.asleepUnspecified, .asleepCore, .asleepDeep, .asleepREM].map { $0.rawValue }.contains(value)
        }
        return value == 1  // HKCategoryValueSleepAnalysis.asleep before iOS 16
    }

    static func name(of type: HKWorkoutActivityType) -> String {
        switch type {
        case .swimming: return "Swimming"
        case .cycling: return "Cycling"
        case .walking: return "Walking"
        case .running: return "Running"
        case .rowing: return "Rowing"
        case .yoga: return "Yoga"
        case .pilates: return "Pilates"
        case .traditionalStrengthTraining, .functionalStrengthTraining: return "Strength"
        case .highIntensityIntervalTraining: return "HIIT"
        case .elliptical: return "Elliptical"
        case .hiking: return "Hiking"
        case .socialDance, .cardioDance: return "Dance"
        case .climbing: return "Climbing"
        case .tennis: return "Tennis"
        case .soccer: return "Soccer"
        case .mindAndBody: return "Mind and body"
        case .flexibility: return "Stretching"
        default: return "Workout"
        }
    }
}
