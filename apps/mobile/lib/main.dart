import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'features/home/home_page.dart';

void main() {
  runApp(const ProviderScope(child: DidarApp()));
}

class DidarApp extends StatelessWidget {
  const DidarApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'دیدار',
      debugShowCheckedModeBanner: false,
      locale: const Locale('fa', 'IR'),
      supportedLocales: const [Locale('fa', 'IR'), Locale('en', 'US')],
      theme: ThemeData(
        // Placeholder theme — the real design system lands with the work described
        // in docs/product/blueprint.md ("Design System... ساختار Android").
        colorSchemeSeed: const Color(0xFF171717),
        useMaterial3: true,
      ),
      builder: (context, child) {
        // fa-IR is RTL; force it at the app root regardless of device locale
        // fallback so the shell always renders correctly for the primary market.
        return Directionality(textDirection: TextDirection.rtl, child: child!);
      },
      home: const HomePage(),
    );
  }
}
