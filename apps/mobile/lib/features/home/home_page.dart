import 'package:flutter/material.dart';

/// Placeholder home screen — proves the feature-module structure
/// (lib/features/<feature>/) end to end. Real bottom navigation (خانه /
/// دسته‌بندی / جستجو / سبد / حساب — blueprint §113) and the actual catalog
/// browsing experience are not built yet.
class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('دیدار')),
      body: const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'اسکلت اولیه. جزئیات معماری در docs/product/blueprint.md بخش ۷۱.',
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}
