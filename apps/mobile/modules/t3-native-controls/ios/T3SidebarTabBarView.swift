import ExpoModulesCore
import UIKit

private final class WorkspaceTabBar: UITabBar {
  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    invalidateIntrinsicContentSize()
  }
}

final class T3SidebarTabBarView: ExpoView, UITabBarDelegate {
  let onSelectionChange = EventDispatcher()
  private let tabBar = WorkspaceTabBar()
  private var itemsByTab: [String: UITabBarItem] = [:]
  var tabs = ["threads", "pullRequests", "usage", "settings"] {
    didSet { if tabs != oldValue { updateItems() } }
  }
  var selectedTab = "threads" { didSet { updateSelection() } }
  var selectedColor: UIColor = .systemBlue { didSet { tabBar.tintColor = selectedColor } }
  var appearance = "light" {
    didSet { overrideUserInterfaceStyle = appearance == "dark" ? .dark : .light }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    tabBar.itemPositioning = .fill
    // iPad's regular bar uses a compressed inline row even with fill positioning.
    // This floating sidebar control needs the same full-size items as a phone bar.
    if #available(iOS 17.0, *) {
      tabBar.traitOverrides.horizontalSizeClass = .compact
    }
    tabBar.delegate = self
    tabBar.translatesAutoresizingMaskIntoConstraints = false
    addSubview(tabBar)
    NSLayoutConstraint.activate([
      tabBar.leadingAnchor.constraint(equalTo: leadingAnchor),
      tabBar.trailingAnchor.constraint(equalTo: trailingAnchor),
      tabBar.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
    prepareItems()
    updateItems()
  }

  private func prepareItems() {
    let iconBundle = Bundle(for: Self.self).url(forResource: "T3NativeControlIcons", withExtension: "bundle").flatMap(Bundle.init(url:))
    let pullRequestIcon = UIImage(named: "pull-request", in: iconBundle, compatibleWith: nil)?.withRenderingMode(.alwaysTemplate)
    let labels = ["threads": "Bots", "pullRequests": "PRs", "usage": "Usage", "settings": "Settings"]
    let symbols = ["threads": "text.bubble", "usage": "chart.bar", "settings": "gearshape"]
    for (tab, label) in labels {
      let icon = tab == "pullRequests" ? pullRequestIcon : tabSymbol(symbols[tab] ?? "circle")
      let item = UITabBarItem(title: nil, image: tabIcon(icon), tag: 0)
      item.accessibilityLabel = label
      item.accessibilityIdentifier = "workspace-tab-\(tab)"
      if let symbol = symbols[tab] { item.selectedImage = tabIcon(tabSymbol("\(symbol).fill")) }
      itemsByTab[tab] = item
    }
  }

  private func updateItems() {
    tabBar.items = tabs.enumerated().compactMap { index, tab in
      guard let item = itemsByTab[tab] else { return nil }
      item.tag = index
      return item
    }
    updateSelection()
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    tabBar.hitTest(convert(point, to: tabBar), with: event)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateSelection()
  }

  private func tabSymbol(_ name: String) -> UIImage? {
    UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(pointSize: 26, weight: .semibold))
  }

  // Give symbols and bitmap assets the same image box; UIKit otherwise scales symbols independently.
  private func tabIcon(_ image: UIImage?) -> UIImage? {
    guard let image else { return nil }
    let canvas = CGSize(width: 30, height: 30)
    let scale = min(27 / image.size.width, 27 / image.size.height)
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    return UIGraphicsImageRenderer(size: canvas).image { _ in
      image.draw(in: CGRect(x: (canvas.width - size.width) / 2, y: (canvas.height - size.height) / 2, width: size.width, height: size.height))
    }.withRenderingMode(.alwaysTemplate)
  }

  private func updateSelection() {
    guard let item = itemsByTab[selectedTab], tabBar.items?.contains(item) == true else { return }
    guard tabBar.selectedItem !== item else { return }
    tabBar.selectedItem = item
  }

  func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    guard tabs.indices.contains(item.tag) else { return }
    onSelectionChange(["tab": tabs[item.tag]])
  }
}
